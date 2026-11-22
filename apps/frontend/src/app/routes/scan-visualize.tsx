import { ArrowLeft, ChevronDown, ChevronRight, ListPlus, Monitor, Network, RefreshCw, Router, Tag } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ReactFlow, Background, Controls, useNodesInitialized, useReactFlow, type Edge, type Node } from "@xyflow/react";
import { ContextMenu } from "radix-ui";
import { toast } from "sonner";
import "@xyflow/react/dist/style.css";

import { TagSchema } from "@subsurf/contracts/common/common.schema";
import type { ScanHostDetail, ScanServiceDetail } from "@subsurf/contracts/scans/scan-results.schema";
import { parseTargetValue, TARGET_IMPORT_LIMITS } from "@subsurf/contracts/targets/target-input";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useTagScanHosts } from "@/features/hosts/api/tag-scan-hosts";
import { HostEditDialog } from "@/features/hosts/components/host-edit-dialog";
import { HostSheet } from "@/features/hosts/components/host-sheet";
import { ServiceEditDialog } from "@/features/hosts/components/service-edit-dialog";
import { useScan } from "@/features/scans/api/get-scan";
import { useVisualizationHosts } from "@/features/scans/api/get-visualization-hosts";
import { buildVisualizationTree, visibleVisualizationTree, visualizationHostIps, type VisualizationBranch } from "@/features/scans/lib/visualization-tree";
import { useImportTargets } from "@/features/targets/api/import-targets";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";

const X_GAP = 240;
const Y_GAP = 160;

type Dialog =
  | { kind: "host"; host: ScanHostDetail }
  | { kind: "service"; host: ScanHostDetail; service: ScanServiceDetail };

type NodeAction = { kind: "target" | "tag"; branch: VisualizationBranch };

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

function NodeContextMenu({
  branch,
  children,
  canCreateTargets,
  canTagHosts,
  onAction,
}: {
  branch: VisualizationBranch;
  children: ReactNode;
  canCreateTargets: boolean;
  canTagHosts: boolean;
  onAction: (action: NodeAction) => void;
}) {
  const { t } = useTranslation();
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-44 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-xl outline-none">
          <ContextMenu.Item disabled={!canCreateTargets} onSelect={() => onAction({ kind: "target", branch })} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent">
            <ListPlus className="size-4" />{t("scans.visualization.addToTargets")}
          </ContextMenu.Item>
          <ContextMenu.Item disabled={!canTagHosts} onSelect={() => onAction({ kind: "tag", branch })} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent">
            <Tag className="size-4" />{t("scans.visualization.addTag")}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function ScanVisualizeRoute() {
  const { scanId = "" } = useParams();
  const { t } = useTranslation();
  const { t: th } = useTranslation("hosts");
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [nodeAction, setNodeAction] = useState<NodeAction | null>(null);
  const [targetMode, setTargetMode] = useState<"hosts" | "cidr">("hosts");
  const [tag, setTag] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canCreateTargets = useCan("targets:create");
  const canTagHosts = useCan("hosts:update");
  const importTargets = useImportTargets();
  const tagHosts = useTagScanHosts();
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

  const openNodeAction = useCallback((action: NodeAction) => {
    setActionError(null);
    setTargetMode("hosts");
    setNodeAction(action);
  }, []);

  const closeNodeAction = () => {
    setNodeAction(null);
    setTargetMode("hosts");
    setTag("");
    setTagError(null);
    setActionError(null);
  };

  function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nodeAction?.kind !== "tag" || !canTagHosts) return;
    const value = tag.trim();
    if (!TagSchema.safeParse(value).success) {
      setTagError(t("scans.visualization.tagInvalid"));
      return;
    }
    const selector = nodeAction.branch.kind === "prefix" ? nodeAction.branch.cidr : nodeAction.branch.ip;
    tagHosts.mutate(
      { params: { path: { id: scanId } }, body: { action: "add", tag: value, selectors: [selector] } },
      {
        onSuccess: (result) => {
          if (result.matched === 0) {
            setActionError(t("scans.visualization.noHosts"));
            return;
          }
          const notify = result.limitReached > 0 ? toast.warning : toast.success;
          notify(t("scans.visualization.tagAdded", { count: result.changed, tag: value }), {
            description: result.limitReached > 0
              ? t("scans.visualization.tagLimited", { count: result.limitReached })
              : undefined,
          });
          closeNodeAction();
        },
        onError: (error) => setActionError(errorMessage(error)),
      },
    );
  }

  function addTargets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nodeAction?.kind !== "target" || !canCreateTargets) return;
    const branch = nodeAction.branch;
    const values = targetMode === "cidr" && branch.kind === "prefix"
      ? [branch.cidr]
      : visualizationHostIps(branch);
    if (values.length > TARGET_IMPORT_LIMITS.maxEntries) {
      setActionError(t("scans.visualization.tooManyTargets", { count: values.length }));
      return;
    }
    const invalid = values.find((value) => !parseTargetValue(value).ok);
    if (invalid) {
      setActionError(t("scans.visualization.invalidTarget", { value: invalid }));
      return;
    }
    importTargets.mutate(
      { body: { entries: values.map((value) => ({ value })), startScan: false } },
      {
        onSuccess: (result) => {
          toast.success(t("scans.visualization.targetsAdded", { created: result.created, skipped: result.skipped }), {
            action: { label: t("scans.visualization.viewTargets"), onClick: () => void navigate("/app/targets") },
          });
          closeNodeAction();
        },
        onError: (error) => setActionError(errorMessage(error)),
      },
    );
  }

  const { nodes, edges } = useMemo(() => {
    if (!tree) return { nodes: [] as Node[], edges: [] as Edge[] };
    const treeX = visible.find((item) => item.branch.id === tree.id)?.x ?? 0;
    const nextNodes: Node[] = [{
      id: "scan",
      position: { x: treeX * X_GAP, y: 0 },
      data: { label: <NodeContextMenu branch={tree} canCreateTargets={canCreateTargets} canTagHosts={canTagHosts} onAction={openNodeAction}>
        <div className="flex w-48 items-center gap-3 rounded-xl border border-brand/50 bg-card p-3 text-left shadow-lg">
          <Network className="size-7 shrink-0 text-brand" />
          <span><strong className="block text-sm">{t("scans.visualization.root")}</strong><small className="text-muted-foreground">{t("scans.visualization.hostCount", { count: tree.count })}</small></span>
        </div>
      </NodeContextMenu> },
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
          <NodeContextMenu branch={branch} canCreateTargets={canCreateTargets} canTagHosts={canTagHosts} onAction={openNodeAction}>
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
          </NodeContextMenu>
        ) },
        style: nodeStyle,
        draggable: false,
      });
      nextEdges.push({ id: `${parentId}:${branch.id}`, source: parentId, target: branch.id, type: "smoothstep", style: { stroke: "#64748b", strokeWidth: 2 } });
    }
    return { nodes: nextNodes, edges: nextEdges };
  }, [tree, visible, expanded, t, th, activateNode, canCreateTargets, canTagHosts, openNodeAction]);

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
      {nodeAction?.kind === "tag" && <Dialog open onOpenChange={(open) => !open && closeNodeAction()}>
        <DialogContent>
          <form onSubmit={addTag} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("scans.visualization.addTag")}</DialogTitle>
              <DialogDescription>{t("scans.visualization.tagDescription", { address: nodeAction.branch.kind === "prefix" ? nodeAction.branch.cidr : nodeAction.branch.ip })}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="visualization-tag">{t("scans.visualization.tagLabel")}</Label>
              <Input id="visualization-tag" value={tag} maxLength={50} onChange={(event) => { setTag(event.target.value); setTagError(null); setActionError(null); }} aria-invalid={tagError ? true : undefined} />
              {tagError && <p role="alert" className="text-sm text-destructive">{tagError}</p>}
              {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={closeNodeAction}>{t("scans.visualization.cancel")}</Button><Button type="submit" disabled={tagHosts.isPending}>{t("scans.visualization.addTag")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>}
      {nodeAction?.kind === "target" && <Dialog open onOpenChange={(open) => !open && closeNodeAction()}>
        <DialogContent>
          <form onSubmit={addTargets} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("scans.visualization.addToTargets")}</DialogTitle>
              <DialogDescription>{t("scans.visualization.targetDescription", { address: nodeAction.branch.kind === "prefix" ? nodeAction.branch.cidr : nodeAction.branch.ip })}</DialogDescription>
            </DialogHeader>
            {nodeAction.branch.kind === "prefix" && <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t("scans.visualization.targetScope")}</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
                <input type="radio" name="target-scope" value="hosts" checked={targetMode === "hosts"} onChange={() => setTargetMode("hosts")} />
                <span>{t("scans.visualization.onlyScanned", { count: nodeAction.branch.count })}</span>
              </label>
              {parseTargetValue(nodeAction.branch.cidr).ok && <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
                <input type="radio" name="target-scope" value="cidr" checked={targetMode === "cidr"} onChange={() => setTargetMode("cidr")} />
                <span>{t("scans.visualization.entireCidr", { cidr: nodeAction.branch.cidr })}</span>
              </label>}
            </fieldset>}
            {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={closeNodeAction}>{t("scans.visualization.cancel")}</Button><Button type="submit" disabled={importTargets.isPending}>{t("scans.visualization.addToTargets")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>}
    </div>
  );
}
