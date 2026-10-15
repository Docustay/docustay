import {
  DrawerContent,
  DrawerFooter,
  DrawerTitle,
} from "@/lib/components/ui/drawer";

export default function PhoneSheetDrawer1Drawer({
  open,
  onOpenChange,
  title,
  children,
  footer,
}) {
  if (!open) {
    return null;
  }

  return (
    <DrawerContent className="rounded-t-[20px] shadow-[0_-16px_44px_rgba(20,20,25,0.2)] pt-[10px] px-[18px] pb-[28px] bg-surface">
      <div className="flex justify-center mb-[14px]">
        <div className="w-[38px] h-1 rounded-full bg-grab" />
      </div>
      {title && <DrawerTitle>{title}</DrawerTitle>}
      <div className="flex-1 overflow-y-auto px-0">
        {children}
      </div>
      {footer && (
        <DrawerFooter className="flex flex-col gap-2 p-0 mt-auto">
          {footer}
        </DrawerFooter>
      )}
    </DrawerContent>
  );
}
