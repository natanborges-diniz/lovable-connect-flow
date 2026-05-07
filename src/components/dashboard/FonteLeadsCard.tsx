import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Globe, Instagram, HelpCircle } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useFonteLeads, type FontePeriodo } from "@/hooks/useFonteLeads";

const COLORS = {
  site: "hsl(220, 70%, 50%)",
  instagram: "hsl(320, 65%, 55%)",
  outro: "hsl(0, 0%, 60%)",
} as const;

const LABELS: Record<string, string> = {
  site: "Site",
  instagram: "Instagram",
  outro: "Outro / não identificado",
};

export function FonteLeadsCard() {
  const [periodo, setPeriodo] = useState<FontePeriodo>("30d");
  const { data, isLoading } = useFonteLeads(periodo);

  const { totals, donut, timeline } = useMemo(() => {
    const rows = data ?? [];
    const t = { site: 0, instagram: 0, outro: 0 } as Record<string, number>;
    const byDay = new Map<string, { date: string; site: number; instagram: number }>();
    for (const r of rows) {
      t[r.fonte]++;
      const day = r.created_at.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { date: day, site: 0, instagram: 0 });
      const b = byDay.get(day)!;
      if (r.fonte === "site") b.site++;
      else if (r.fonte === "instagram") b.instagram++;
    }
    const donutArr = (["site", "instagram", "outro"] as const)
      .map((k) => ({ name: LABELS[k], value: t[k], fill: COLORS[k] }))
      .filter((d) => d.value > 0);
    const timelineArr = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
    return { totals: t, donut: donutArr, timeline: timelineArr };
  }, [data]);

  const total = totals.site + totals.instagram + totals.outro;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const periodos: { key: FontePeriodo; label: string }[] = [
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
    { key: "90d", label: "90 dias" },
    { key: "all", label: "Tudo" },
  ];

  return (
    <Card className="shadow-card mb-6">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Globe className="h-4 w-4" /> Origem dos Leads
          </CardTitle>
          <div className="flex gap-1">
            {periodos.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={periodo === p.key ? "default" : "outline"}
                onClick={() => setPeriodo(p.key)}
                className="text-xs h-7"
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <KpiTile icon={<Globe className="h-4 w-4" />} label="Site" value={totals.site} pct={pct(totals.site)} color={COLORS.site} />
          <KpiTile icon={<Instagram className="h-4 w-4" />} label="Instagram" value={totals.instagram} pct={pct(totals.instagram)} color={COLORS.instagram} />
          <KpiTile icon={<HelpCircle className="h-4 w-4" />} label="Outro" value={totals.outro} pct={pct(totals.outro)} color={COLORS.outro} />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sem leads neste período</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-2">Distribuição</p>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} label={(e: any) => `${e.value}`}>
                    {donut.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Leads por dia</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: "0.75rem", border: "1px solid hsl(var(--border))" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="site" name="Site" stroke={COLORS.site} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="instagram" name="Instagram" stroke={COLORS.instagram} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiTile({ icon, label, value, pct, color }: { icon: React.ReactNode; label: string; value: number; pct: number; color: string }) {
  return (
    <div className="rounded-lg border p-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-md flex items-center justify-center text-white shrink-0" style={{ backgroundColor: color }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold leading-none">{value}</div>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">{pct}%</div>
    </div>
  );
}
