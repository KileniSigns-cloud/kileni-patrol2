export const FLOW_STEPS = ['Business', 'Photos', 'Patrol type', 'Sign type', 'Issues'] as const;

/** 5-segment progress bar plus "Step N of 5: Name". `step` is 0-based. */
const StepProgress: React.FC<{ step: number }> = ({ step }) => (
  <div className="mt-1">
    <div className="flex gap-1.5 mt-2 mb-1.5" aria-hidden>
      {FLOW_STEPS.map((name, i) => (
        <i key={name} className={`flex-1 h-[5px] rounded-[3px] ${i <= step ? 'bg-pri' : 'bg-line'}`} />
      ))}
    </div>
    <div className="text-[13px] text-mut font-bold">
      Step {step + 1} of {FLOW_STEPS.length}: {FLOW_STEPS[step]}
    </div>
  </div>
);

export default StepProgress;
