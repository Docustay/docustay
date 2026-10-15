import React from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/lib/components/ui/chart";

export default function Chart({
  type = "bar",
  data = [],
  xKey = "",
  yKey = "",
  ...rest
}) {
  // Default chart config for colors
  const config = {
    [yKey]: {
      label: yKey,
      color: "var(--color-brand)",
    },
  };

  const chartContent =
    type === "line" ? (
      <LineChart data={data} {...rest}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          type="monotone"
          dataKey={yKey}
          stroke="var(--color-brand)"
          dot={false}
        />
      </LineChart>
    ) : (
      <BarChart data={data} {...rest}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey={yKey} fill="var(--color-brand)" />
      </BarChart>
    );

  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full">
      {chartContent}
    </ChartContainer>
  );
}
