interface FlowFooterProps {
  /** One line saying what's missing before Next can be used. */
  hint?: string | null;
  children: React.ReactNode;
}

/** Fixed action bar for flow screens (Back / Next). */
const FlowFooter: React.FC<FlowFooterProps> = ({ hint, children }) => (
  <div
    className="fixed inset-x-0 bottom-0 z-[5] bg-bg border-t border-line px-4 pt-3"
    style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
  >
    <div className="max-w-[528px] mx-auto flex flex-col gap-2.5">
      {hint && <p className="m-0 text-mut text-sm text-center font-semibold" role="status">{hint}</p>}
      {children}
    </div>
  </div>
);

/** Back + primary pair: the primary button takes two thirds of the row. */
export const FooterRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex gap-2.5 [&>*]:flex-1 [&>.btn-pri]:flex-[2] [&>.btn-danger]:flex-[2]">{children}</div>
);

export default FlowFooter;
