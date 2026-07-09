#!/bin/sh
# Install reasonix-code — the Reasonix-Code CLI binary.
# Downloads the latest (or specified) release from GitHub, installs to
# ~/.reasonix-code/bin, and adds it to PATH.
#
# Usage:
#   ./install.sh
#   ./install.sh v0.1.0
#   ./install.sh -s        # silent (non-error output suppressed)

set -e

REPO_OWNER="Zehee"
REPO_NAME="Reasonix-Code"
VERSION=""
SILENT=""

while [ $# -gt 0 ]; do
  case "$1" in
    -s|--silent) SILENT=1 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) VERSION="$1" ;;
  esac
  shift
done

INSTALL_DIR="$HOME/.reasonix-code/bin"
TARGET="$INSTALL_DIR/reasonix-code"

info() {
  if [ -z "$SILENT" ]; then
    printf '\033[36m%s\033[0m\n' "$1"
  fi
}

success() {
  if [ -z "$SILENT" ]; then
    printf '\033[32m%s\033[0m\n' "$1"
  fi
}

warn() {
  if [ -z "$SILENT" ]; then
    printf '\033[33m%s\033[0m\n' "$1"
  fi
}

detect_platform() {
  case "$(uname -sm)" in
    "Darwin x86_64" | "Darwin arm64") echo "macos" ;;
    "Linux x86_64") echo "linux" ;;
    *) echo "unsupported" ;;
  esac
}

PLATFORM=$(detect_platform)
if [ "$PLATFORM" = "unsupported" ]; then
  echo "Unsupported platform: $(uname -sm)" >&2
  exit 1
fi

if [ -z "$VERSION" ]; then
  info "Fetching latest release info..."
  if ! VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest" | grep '"tag_name":' | head -n 1 | cut -d'"' -f4); then
    echo "Failed to fetch latest release" >&2
    exit 1
  fi
fi

info "Target version: $VERSION"

# Check existing installation
INSTALLED_VERSION=""
if [ -x "$TARGET" ]; then
  INSTALLED_VERSION=$("$TARGET" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)
fi

TARGET_PLAIN=$(printf '%s' "$VERSION" | sed 's/^v//')
if [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" = "$TARGET_PLAIN" ]; then
  success "reasonix-code $INSTALLED_VERSION is already up to date at '$TARGET'."
  exit 0
fi

ASSET="reasonix-code-$PLATFORM"
URL="https://github.com/$REPO_OWNER/$REPO_NAME/releases/download/$VERSION/$ASSET"

mkdir -p "$INSTALL_DIR"
TMP_TARGET="$TARGET.$VERSION.tmp"

info "Downloading $ASSET ..."
if ! curl -fsSL "$URL" -o "$TMP_TARGET"; then
  echo "Download failed: $URL" >&2
  rm -f "$TMP_TARGET"
  exit 1
fi

chmod +x "$TMP_TARGET"

info "Verifying binary..."
if ! "$TMP_TARGET" --version >/dev/null 2>&1; then
  echo "Installed binary does not run correctly" >&2
  rm -f "$TMP_TARGET"
  exit 1
fi

mv -f "$TMP_TARGET" "$TARGET"
success "Installed reasonix-code ($VERSION) to $TARGET"

# Add to PATH if not already present
if [ -d "$INSTALL_DIR" ] && [ -n "$(command -v reasonix-code)" ]; then
  if [ "$(command -v reasonix-code)" != "$TARGET" ]; then
    warn "'reasonix-code' on your PATH points to a different location."
    warn "Make sure '$INSTALL_DIR' comes before it in your PATH."
  fi
fi

case ":${PATH}:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    success "Adding '$INSTALL_DIR' to PATH..."
    SHELL_PROFILE=""
    if [ -n "${ZSH_VERSION:-}" ] || [ "${SHELL:-}" = */zsh ]; then
      SHELL_PROFILE="$HOME/.zshrc"
    elif [ -n "${BASH_VERSION:-}" ] || [ "${SHELL:-}" = */bash ]; then
      SHELL_PROFILE="$HOME/.bashrc"
    fi
    if [ -n "$SHELL_PROFILE" ]; then
      printf '\n# Reasonix-Code CLI\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$SHELL_PROFILE"
      warn "Please restart your terminal or run: source $SHELL_PROFILE"
    else
      warn "Could not detect shell profile. Add the following to your profile:"
      warn "export PATH=\"$INSTALL_DIR:\$PATH\""
    fi
    ;;
esac

success "Done! Run 'reasonix-code' in your project directory to get started."
