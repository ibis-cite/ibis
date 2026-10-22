import { ToggleButton as AriaToggleButton, type ToggleButtonProps } from "react-aria-components";
import "./ToggleButton.css";

/** A neutral, keyboard-focusable toggle shared by icon controls. */
export function ToggleButton({ className = "", ...props }: Omit<ToggleButtonProps, "className"> & { className?: string }) {
  return <AriaToggleButton {...props} className={`ui-toggle-button ${className}`} />;
}
