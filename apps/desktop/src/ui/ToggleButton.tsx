import type { ComponentPropsWithRef } from "react";
import { ToggleButton as AriaToggleButton } from "react-aria-components";
import "./ToggleButton.css";

type Props = Omit<ComponentPropsWithRef<typeof AriaToggleButton>, "className" | "render">
  & Pick<ComponentPropsWithRef<"button">, "aria-keyshortcuts"> & { className?: string };

/** A neutral toggle; the DOM render preserves RAC's composed props and ref. */
export function ToggleButton({ className = "", "aria-keyshortcuts": shortcut, ...props }: Props) {
  return <AriaToggleButton {...props} className={`ui-toggle-button ${className}`}
    render={(domProps) => <button {...domProps} aria-keyshortcuts={shortcut} />} />;
}
