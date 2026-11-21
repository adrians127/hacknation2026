import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  type RowData,
} from "@tanstack/react-table";

/** Per-column options read by `components/data-table.tsx`. */
export interface DataTableColumnMeta {
  /** Added to the header and every cell of the column, e.g. `text-right`. */
  className?: string;
}

// Type-only slot: tells v9 what `columnDef.meta` holds.
const columnMeta: DataTableColumnMeta = {};

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  columnMeta,
});

export type DataTableFeatures = typeof dataTableFeatures;

export const createDataTableColumns = <TData extends RowData>() =>
  createColumnHelper<DataTableFeatures, TData>();

/** What `createDataTableColumns<T>().columns([...])` returns. */
export type DataTableColumns<TData extends RowData> = ReturnType<
  ReturnType<typeof createDataTableColumns<TData>>["columns"]
>;
