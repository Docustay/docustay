import { Skeleton } from "@/lib/components/ui/skeleton.jsx";

export default function HomeLoading() {
  return (
    <section className="flex flex-col gap-0" data-testid="home-loading">
      {/* HERO BAND SKELETON */}
      <div className="bg-surface border-b border-line px-[30px] py-[26px] mb-[18px]">
        <div className="mb-[14px]">
          <Skeleton className="h-[46px] w-[260px]" />
        </div>
        <div className="mb-[8px]">
          <Skeleton className="h-[14px] w-[70%]" />
        </div>
        <div>
          <Skeleton className="h-[14px] w-[54%]" />
        </div>
      </div>

      {/* PROMPT BAND SKELETON */}
      <div className="flex flex-col gap-[10px] px-[30px] mb-[30px]">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-[15px] bg-surface border border-line rounded-card px-[17px] py-[15px]">
            <Skeleton className="h-[30px] w-[30px] rounded-control flex-shrink-0" />
            <div className="flex-1">
              <div className="mb-[8px]">
                <Skeleton className="h-[14px] w-[46%]" />
              </div>
              <Skeleton className="h-[12px] w-[78%]" />
            </div>
          </div>
        ))}
      </div>

      {/* THREE COLUMNS LAYOUT */}
      <div className="flex flex-col gap-[22px] px-[30px] pb-[70px] lg:flex-row">
        {/* LEFT COLUMN */}
        <div className="flex-1 min-w-0">
          {/* TODAY SECTION */}
          <div className="bg-surface border border-line rounded-card px-[17px] py-[14px] mb-[18px]">
            <div className="mb-[14px]">
              <Skeleton className="h-[14px] w-[110px]" />
            </div>
            <div className="flex flex-col gap-0">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-[15px] w-full mb-[12px] last:mb-0" />
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="w-full lg:w-[320px] lg:flex-shrink-0">
          {/* YOUR PEOPLE SECTION */}
          <div className="bg-surface border border-line rounded-card px-[17px] py-[14px] mb-[18px]">
            <div className="mb-[14px]">
              <Skeleton className="h-[14px] w-[140px]" />
            </div>
            <div className="flex flex-col gap-0">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[15px] w-full mb-[12px] last:mb-0" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
