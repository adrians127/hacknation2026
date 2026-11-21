import { useTable, type RowData } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dataTableFeatures, type DataTableColumns } from "@/lib/data-table";
import { cn } from "@/lib/utils";

const SORT_ICONS = { asc: ArrowUp, desc: ArrowDown } as const;

/**
 * Sortable table on TanStack Table v9. Columns come from `createDataTableColumns<T>()`
 * and, like `data`, must be stable (`useMemo`): v9 rebuilds the table when they change.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  emptyLabel,
  rowClassName,
  renderExpanded,
}: {
  columns: DataTableColumns<TData>;
  data: TData[];
  emptyLabel?: string;
  rowClassName?: (row: TData) => string | undefined;
  /** Content of a full-width row under the row, or `null` while it is collapsed. */
  renderExpanded?: (row: TData) => ReactNode;
}) {
  const { t } = useTranslation();
  const table = useTable({ features: dataTableFeatures, columns, data });
  const rows = table.getRowModel().rows;

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const SortIcon = sorted ? SORT_ICONS[sorted] : ArrowUpDown;
              return (
                <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="-ml-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:text-foreground"
                    >
                      <table.FlexRender header={header} />
                      <SortIcon className={cn("size-3.5", !sorted && "opacity-40")} />
                    </button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
              {emptyLabel ?? t("table.empty")}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const expanded = renderExpanded?.(row.original);
            return (
              <Fragment key={row.id}>
                <TableRow className={rowClassName?.(row.original)}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
                {expanded != null && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={columns.length} className="p-0">
                      {expanded}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
