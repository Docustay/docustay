import { useEffect, useState } from "react";
import { Drawer } from "@/lib/components/ui/drawer";
import PhoneSheetDrawer1Drawer from "./PhoneSheetDrawer1Drawer";

export default function PhoneSheet({
  open = false,
  onOpenChange = null,
  title = null,
  onClose = null,
  children = null,
  footer = null,
}) {
  const [internalOpen, setInternalOpen] = useState(open);

  useEffect(() => {
    setInternalOpen(open);
  }, [open]);

  const handleOpenChange = (newOpen) => {
    setInternalOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) {
      onClose?.();
    }
  };

  return (
    <Drawer open={internalOpen} onOpenChange={handleOpenChange}>
      <PhoneSheetDrawer1Drawer
        open={internalOpen}
        onOpenChange={handleOpenChange}
        title={title}
        footer={footer}
      >
        {children}
      </PhoneSheetDrawer1Drawer>
    </Drawer>
  );
}
