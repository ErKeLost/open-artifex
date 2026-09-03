import { ToolTimeline } from "./ToolTimeline";
import { mockTimelineItems } from "./timeline.mock";

/** Development fallback. Production screens should pass streamed items to ToolTimeline. */
export function TimelineShowcase() {
  return (
    <section aria-label="工具调用时间线示例" className="oa-timeline-demo">
      <ToolTimeline items={mockTimelineItems} />
    </section>
  );
}
