import { useTable, type RowData } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
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
}: {
  columns: DataTableColumns<TData>;
  data: TData[];
  emptyLabel?: string;
  rowClassName?: (row: TData) => string | undefined;
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
          rows.map((row) => (
            <TableRow key={row.id} className={rowClassName?.(row.original)}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
