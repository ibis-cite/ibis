import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import "./ChipDisclosure.css";

/** The selected-chip overflow: React Aria owns its dialog, placement and focus. */
export function ChipDisclosure({ label, triggerLabel, trigger, triggerRef, isOpen, onOpenChange, children }: {
  label: string; triggerLabel: string; trigger: ReactNode; triggerRef?: Ref<HTMLButtonElement>;
  isOpen: boolean; onOpenChange: (open: boolean) => void; children: ReactNode;
}) {
  const composing = useRef(false);
  useEffect(() => { if (!isOpen) composing.current = false; }, [isOpen]);
  return <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
    <Button ref={triggerRef} aria-label={triggerLabel} className="chip-disclosure-trigger">{trigger}</Button>
    <Popover className="chip-disclosure" placement="top end">
      <div
        onCompositionStartCapture={() => { composing.current = true; }}
        onCompositionEndCapture={() => { composing.current = false; }}
        onKeyDownCapture={(event) => {
          if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) event.stopPropagation();
        }}>
        <Dialog aria-label={label} className="chip-disclosure-content">{children}</Dialog>
      </div>
    </Popover>
  </DialogTrigger>;
}
