import * as React from "react";

/**
 * Controls returned by useDisclosure.
 */
export interface DisclosureControls {
  /** Opens the disclosure. */
  open: () => void;
  /** Closes the disclosure. */
  close: () => void;
  /** Toggles the disclosure or forces a supplied state. */
  toggle: (value?: boolean) => void;
  /** Sets the disclosure state directly. */
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Manages open/closed state for dialogs, popovers, and disclosure widgets.
 */
export function useDisclosure(initialOpen = false): [boolean, DisclosureControls] {
  const [isOpen, setOpen] = React.useState(initialOpen);
  const open = React.useCallback(() => setOpen(true), []);
  const close = React.useCallback(() => setOpen(false), []);
  const toggle = React.useCallback((next?: boolean) => {
    setOpen((current) => (typeof next === "boolean" ? next : !current));
  }, []);

  return [isOpen, { open, close, toggle, setOpen }];
}
