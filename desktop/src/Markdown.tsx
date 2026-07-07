import { Children, type ReactNode, isValidElement } from "react";

export function extractFencedLang(children: ReactNode): string {
  for (const kid of Children.toArray(children)) {
    if (isValidElement(kid)) {
      const cls = (kid.props as Record<string, unknown>).className;
      if (typeof cls === "string") {
        const m = cls.match(/language-([\w-]+)/);
        if (m) return m[1]!;
      }
    }
  }
  return "text";
}
