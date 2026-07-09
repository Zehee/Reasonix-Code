#!/bin/sh
# Install reasonix-code via npm.
# Requires Node.js >= 22 and npm.
#
# Usage:
#   ./install.sh
#   ./install.sh 0.1.0
#   ./install.sh -s        # silent

set -e

PACKAGE_NAME="reasonix-code"
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

# ── Validate environment ───────────────────────────────────────────────
node_major=""
if command -v node >/dev/null 2>&1; then
  node_version=$(node --version 2>/dev/null)
  node_major=$(printf '%s' "$node_version" | sed -n 's/^v\?\([0-9]*\).*/\1/p')
fi

if [ -z "$node_major" ] || [ "$node_major" -lt 22 ]; then
  echo "Node.js >= 22 and npm are required to install reasonix-code." >&2
  echo "Please install Node.js first: https://nodejs.org/en/download" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found." >&2
  exit 1
fi

info "Node.js $node_version / npm $(npm --version) detected."

# ── Install ────────────────────────────────────────────────────────────
version_spec="$PACKAGE_NAME"
if [ -n "$VERSION" ]; then
  version_spec="$PACKAGE_NAME@$VERSION"
fi

info "Installing $version_spec via npm..."
if ! npm install -g "$version_spec"; then
  echo "npm install failed" >&2
  exit 1
fi

# ── Ensure PATH contains npm global bin ────────────────────────────────
npm_bin=$(npm bin -g 2>/dev/null || true)
if [ -n "$npm_bin" ] && [ -d "$npm_bin" ]; then
  case ":${PATH}:" in
    *":$npm_bin:"*) ;;
    *)
      success "Adding '$npm_bin' to PATH..."
      SHELL_PROFILE=""
      if [ -n "${ZSH_VERSION:-}" ] || [ "${SHELL:-}" = */zsh ]; then
        SHELL_PROFILE="$HOME/.zshrc"
      elif [ -n "${BASH_VERSION:-}" ] || [ "${SHELL:-}" = */bash ]; then
        SHELL_PROFILE="$HOME/.bashrc"
      fi
      if [ -n "$SHELL_PROFILE" ]; then
        printf '\n# Reasonix-Code CLI\nexport PATH="%s:$PATH"\n' "$npm_bin" >> "$SHELL_PROFILE"
        warn "Please restart your terminal or run: source $SHELL_PROFILE"
      else
        warn "Could not detect shell profile. Add the following to your profile:"
        warn "export PATH=\"$npm_bin:\$PATH\""
      fi
      ;;
  esac
fi

# ── Verify ─────────────────────────────────────────────────────────────
if ! command -v reasonix-code >/dev/null 2>&1; then
  echo "reasonix-code was installed but cannot be found on PATH." >&2
  exit 1
fi

verify=$(reasonix-code --version 2>/dev/null || true)
if [ -z "$verify" ]; then
  echo "Installed package does not run correctly." >&2
  exit 1
fi

success "Verified: $verify"
success "Done! Run 'reasonix-code' in your project directory to get started."
