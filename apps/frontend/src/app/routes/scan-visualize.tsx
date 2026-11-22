import { ArrowLeft, ChevronDown, ChevronRight, Monitor, Network, RefreshCw, Router } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { ReactFlow, Background, Controls, useNodesInitialized, useReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { ScanHostDetail, ScanServiceDetail } from "@subsurf/contracts/scans/scan-results.schema";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HostEditDialog } from "@/features/hosts/components/host-edit-dialog";
import { HostSheet } from "@/features/hosts/components/host-sheet";
import { ServiceEditDialog } from "@/features/hosts/components/service-edit-dialog";
import { useScan } from "@/features/scans/api/get-scan";
import { useVisualizationHosts } from "@/features/scans/api/get-visualization-hosts";
import { buildVisualizationTree, visibleVisualizationTree } from "@/features/scans/lib/visualization-tree";
import { useErrorMessage } from "@/hooks/use-error-message";

const X_GAP = 240;
const Y_GAP = 160;

type Dialog =
  | { kind: "host"; host: ScanHostDetail }
  | { kind: "service"; host: ScanHostDetail; service: ScanServiceDetail };

const statusClass: Record<string, string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  timeout: "bg-amber-500",
  cancelled: "bg-slate-500",
  failed: "bg-red-500",
};

const nodeStyle = { background: "transparent", border: "none", boxShadow: "none", padding: 0, width: 196 };

function FitVisibleNodes({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (initialized && count > 0) void fitView({ padding: 0.2, maxZoom: 1.5, duration: 250 });
  }, [count, initialized, fitView]);
  return null;
}

export function ScanVisualizeRoute() {
  const { scanId = "" } = useParams();
  const { t } = useTranslation();
  const { t: th } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const scan = useScan(scanId);
  const hosts = useVisualizationHosts(scanId);
  const tree = useMemo(() => buildVisualizationTree(hosts.data?.items ?? []), [hosts.data]);
  const visible = useMemo(() => visibleVisualizationTree(tree, expanded), [tree, expanded]);
  const openHostId = params.get("host");

  const updateHost = useCallback((hostId: string | null) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (hostId) next.set("host", hostId);
      else next.delete("host");
      return next;
    }, { replace: true });
  }, [setParams]);

  const activateNode = useCallback((id: string) => {
    if (id.startsWith("prefix:")) {
      setExpanded((previous) => {
        const next = new Set(previous);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    } else if (id.startsWith("host:")) {
      updateHost(id.slice("host:".length));
    }
  }, [updateHost]);

  const { nodes, edges } = useMemo(() => {
    if (!tree) return { nodes: [] as Node[], edges: [] as Edge[] };
    const treeX = visible.find((item) => item.branch.id === tree.id)?.x ?? 0;
    const nextNodes: Node[] = [{
      id: "scan",
      position: { x: treeX * X_GAP, y: 0 },
      data: { label: (
        <div className="flex w-48 items-center gap-3 rounded-xl border border-brand/50 bg-card p-3 text-left shadow-lg">
          <Network className="size-7 shrink-0 text-brand" />
          <span><strong className="block text-sm">{t("scans.visualization.root")}</strong><small className="text-muted-foreground">{t("scans.visualization.hostCount", { count: tree.count })}</small></span>
        </div>
      ) },
      style: nodeStyle,
      draggable: false,
    }];
    const nextEdges: Edge[] = [];
    for (const { branch, x, y, parentId } of visible) {
      const prefix = branch.kind === "prefix";
      const open = prefix && expanded.has(branch.id);
      nextNodes.push({
        id: branch.id,
        position: { x: x * X_GAP, y: y * Y_GAP },
        data: { label: (
          <button
            type="button"
            className="nodrag flex w-48 items-center gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-md transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
            aria-label={prefix ? t("scans.visualization.prefixAction", { cidr: branch.cidr, count: branch.count }) : t("scans.visualization.hostAction", { ip: branch.ip })}
            aria-expanded={prefix ? open : undefined}
            onClick={(event) => {
              event.stopPropagation();
              activateNode(branch.id);
            }}
          >
            {prefix ? <Router className="size-7 shrink-0 text-sky-400" /> : <Monitor className="size-7 shrink-0 text-emerald-400" />}
            <span className="min-w-0 flex-1">
              <strong className="block truncate font-mono text-sm">{prefix ? branch.cidr : branch.ip}</strong>
              <small className="flex items-center gap-1.5 text-muted-foreground">
                {prefix ? t("scans.visualization.hostCount", { count: branch.count }) : <><span className={`size-2 rounded-full ${statusClass[branch.status]}`} />{th(`observation.${branch.status}`)}</>}
              </small>
            </span>
            {prefix && (open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />)}
          </button>
        ) },
        style: nodeStyle,
        draggable: false,
      });
      nextEdges.push({ id: `${parentId}:${branch.id}`, source: parentId, target: branch.id, type: "smoothstep", style: { stroke: "#64748b", strokeWidth: 2 } });
    }
    return { nodes: nextNodes, edges: nextEdges };
  }, [tree, visible, expanded, t, th, activateNode]);

  return (
    <div className="grid gap-5">
      <Link to={`/app/scans/${scanId}`} className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />{t("scans.visualization.back")}
      </Link>
      <PageHeader
        title={t("scans.visualization.title")}
        description={t("scans.visualization.description")}
        actions={<Button variant="outline" onClick={() => void hosts.refetch()} disabled={hosts.isFetching}><RefreshCw />{t("scans.visualization.refresh")}</Button>}
      />
      {scan.isPending || hosts.isPending ? <Skeleton className="h-[65vh] w-full" /> : scan.isError ? (
        <p role="alert" className="text-destructive">{errorMessage(scan.error)}</p>
      ) : hosts.isError ? (
        <p role="alert" className="text-destructive">{errorMessage(hosts.error)}</p>
      ) : !tree ? (
        <Card className="p-8 text-center text-muted-foreground">{t("scans.visualization.empty")}</Card>
      ) : (
        <Card className="h-[min(72vh,800px)] min-h-96 overflow-hidden p-0">
          <ReactFlow nodes={nodes} edges={edges} onNodeClick={(_, node) => activateNode(node.id)} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} fitView minZoom={0.1} maxZoom={2} className="bg-background">
            <Background color="#334155" gap={24} size={1} />
            <Controls showInteractive={false} />
            <FitVisibleNodes count={nodes.length} />
          </ReactFlow>
        </Card>
      )}
      {openHostId && scan.data && <HostSheet
        scanId={scanId}
        baseScanId={scan.data.baseScan?.id ?? null}
        hostId={openHostId}
        onClose={() => updateHost(null)}
        onEditHost={(host) => setDialog({ kind: "host", host })}
        onEditService={(host, service) => setDialog({ kind: "service", host, service })}
      />}
      {dialog?.kind === "host" && <HostEditDialog key={dialog.host.id} host={dialog.host} onClose={() => setDialog(null)} />}
      {dialog?.kind === "service" && <ServiceEditDialog key={dialog.service.id} hostId={dialog.host.id} hostIp={dialog.host.ip} service={dialog.service} onClose={() => setDialog(null)} />}
    </div>
  );
}
