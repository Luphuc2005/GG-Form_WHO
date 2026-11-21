import { useEffect, useRef, useState } from "react";
import type { RefObject, MutableRefObject } from "react";
import type { RequiredFieldIssue } from "../utils/requiredFields";

export type RequiredValidationRef = MutableRefObject<(() => boolean) | null>;

export function useRequiredFieldNavigation(
  issues: RequiredFieldIssue[], root: RefObject<HTMLElement>, navigation: RefObject<HTMLElement>,
  reveal: (section: string) => void, compact: boolean, validationRef?: RequiredValidationRef,
) {
  const [attempted, setAttempted] = useState(false);
  const [target, setTarget] = useState<RequiredFieldIssue | null>(null);
  const marked = useRef<HTMLElement[]>([]);
  const displayed = attempted ? issues : [];
  const focus = (issue: RequiredFieldIssue) => { reveal(issue.section); setTarget({...issue}); };
  const validate = () => {
    setAttempted(true);
    if (!issues.length) return true;
    focus(issues[0]); return false;
  };
  useEffect(() => {
    if (!validationRef) return;
    validationRef.current = validate;
    return () => { validationRef.current = null; };
  });
  // Collapsed sections unmount their controls. Mark only controls mounted in
  // this form, after React has opened the section, and clear marks on editing.
  useEffect(() => {
    for (const element of marked.current) {
      element.removeAttribute("aria-invalid"); element.removeAttribute("data-required-missing");
    }
    marked.current = [];
    for (const issue of displayed) {
      const element = root.current?.querySelector<HTMLElement>(`#${CSS.escape(issue.id)}`);
      if (element) {
        element.setAttribute("aria-invalid", "true"); element.setAttribute("data-required-missing", "true");
        marked.current.push(element);
      }
    }
  });
  useEffect(() => {
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      const element = root.current?.querySelector<HTMLElement>(`#${CSS.escape(target.id)}`);
      if (!element) return;
      const control = element.matches("input, select, textarea, button") ? element
        : element.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") || element;
      control.focus({preventScroll: true});
      const offset = compact ? 90 : innerWidth <= 1040 ? (navigation.current?.offsetHeight || 100)+18 : 20;
      const space = Math.max(16, (innerHeight-offset-130-element.offsetHeight)/2);
      window.scrollTo({top: Math.max(0, element.getBoundingClientRect().top+scrollY-offset-space),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    });
    return () => cancelAnimationFrame(frame);
  }, [target, root, navigation, compact]);
  return {validate, issues: displayed, focus};
}
