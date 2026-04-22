'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import {
  DataTableFilter,
  useDataTableFilters,
} from '#/components/data-table-filter'
import type {
  Column,
  ColumnConfig,
  DataTableFilterActions,
  FilterStrategy,
  FiltersState,
} from '#/components/data-table-filter/core/types'
import type { DataTableFiltersOptions } from '#/components/data-table-filter/hooks/use-data-table-filters'
import { EmptyState } from '#/components/admin/layout'
import {
  AdminTableSelectionToolbar,
  useAdminTableSelection,
  type AdminTableSelection,
} from '#/components/admin/table-selection'
import { Button } from '#/components/ui/button'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { filterDataTableRows } from '#/lib/data-table-filters'
import { getDataTableFilterLocale } from '#/lib/i18n'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

type FilterTableOptions<
  TData,
  TColumns extends ReadonlyArray<ColumnConfig<TData, any, any, any>>,
  TStrategy extends FilterStrategy,
> = DataTableFiltersOptions<TData, TColumns, TStrategy>

const ADMIN_TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50] as const
const ADMIN_TABLE_VIEWPORT_CLASS_NAME =
  'h-[clamp(24rem,65vh,36rem)] min-h-0 overflow-auto rounded-lg border [scrollbar-gutter:stable] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card [&_th]:shadow-[0_1px_0_hsl(var(--border))]'
const ADMIN_TABLE_FILL_VIEWPORT_CLASS_NAME =
  'min-h-0 flex-1 overflow-auto rounded-lg border [scrollbar-gutter:stable] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card [&_th]:shadow-[0_1px_0_hsl(var(--border))]'

export function useAdminDataTableFilters<
  TData,
  TColumns extends ReadonlyArray<ColumnConfig<TData, any, any, any>>,
  TStrategy extends FilterStrategy,
>(options: FilterTableOptions<TData, TColumns, TStrategy>) {
  const locale = getDataTableFilterLocale()
  const table = useDataTableFilters(options)

  const rows = useMemo(
    () =>
      options.strategy === 'client'
        ? filterDataTableRows(options.data, table.columns, table.filters)
        : options.data,
    [options.data, options.strategy, table.columns, table.filters],
  )

  return {
    ...table,
    locale,
    rows,
  }
}

export function AdminDataTableFilterBar<TData>(props: {
  table: {
    columns: Column<TData>[]
    filters: FiltersState
    actions: DataTableFilterActions
    strategy: FilterStrategy
    locale: ReturnType<typeof getDataTableFilterLocale>
  }
}) {
  return (
    <DataTableFilter
      columns={props.table.columns}
      filters={props.table.filters}
      actions={props.table.actions}
      strategy={props.table.strategy}
      locale={props.table.locale}
    />
  )
}

export function FilteredAdminTableEmptyState() {
  return (
    <EmptyState
      title={m.admin_table_filtered_empty_title()}
      description={m.admin_table_filtered_empty_description()}
    />
  )
}

type AdminTableRenderContext<TData> = {
  rows: TData[]
  allRows: TData[]
  selection: AdminTableSelection<TData>
}

type AdminTableActionContext<TData> = AdminTableRenderContext<TData> & {
  selectedRows: TData[]
}

export function AdminPaginatedTable<TData>(props: {
  rows: TData[]
  getRowId: (row: TData) => string
  emptyState: ReactNode
  renderTable: (context: AdminTableRenderContext<TData>) => ReactNode
  renderActions?: (context: AdminTableActionContext<TData>) => ReactNode
  toolbar?: ReactNode
  resetPageKey?: string
  fillHeight?: boolean
  pageSizeOptions?: readonly number[]
}) {
  const pageSizeOptions =
    props.pageSizeOptions?.length &&
    props.pageSizeOptions.every(
      (option) => Number.isInteger(option) && option > 0,
    )
      ? props.pageSizeOptions
      : ADMIN_TABLE_PAGE_SIZE_OPTIONS
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(
    pageSizeOptions.includes(25) ? 25 : pageSizeOptions[0],
  )
  const selection = useAdminTableSelection({
    rows: props.rows,
    getRowId: props.getRowId,
  })

  useEffect(() => {
    setPage(1)
  }, [props.resetPageKey])

  const pageCount =
    props.rows.length > 0 ? Math.ceil(props.rows.length / pageSize) : 0
  const currentPage = pageCount > 0 ? Math.min(page, pageCount) : 1

  useEffect(() => {
    if (page !== currentPage) {
      setPage(currentPage)
    }
  }, [currentPage, page])

  const pageRows = useMemo(() => {
    if (pageCount === 0) {
      return []
    }

    const start = (currentPage - 1) * pageSize
    return props.rows.slice(start, start + pageSize)
  }, [currentPage, pageCount, pageSize, props.rows])

  const hasRows = props.rows.length > 0
  const renderContext = {
    rows: pageRows,
    allRows: props.rows,
    selection,
  }
  const actionContext = {
    ...renderContext,
    selectedRows: selection.selectedRows,
  }
  const pageSizeControl = hasRows ? (
    <NativeSelect
      value={String(pageSize)}
      onChange={(event) => {
        setPageSize(Number(event.target.value))
        setPage(1)
      }}
      className="w-[110px]"
      aria-label={m.admin_table_page_size_label()}
    >
      {pageSizeOptions.map((option) => (
        <NativeSelectOption key={option} value={String(option)}>
          {m.admin_table_rows_option({ count: String(option) })}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  ) : null

  const topControls =
    props.toolbar || hasRows ? (
      props.toolbar ? (
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">{props.toolbar}</div>
          {hasRows ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <AdminTableSelectionToolbar selection={selection} />
              {props.renderActions?.(actionContext)}
              {pageSizeControl}
            </div>
          ) : null}
        </div>
      ) : hasRows ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminTableSelectionToolbar selection={selection} />
          {props.renderActions?.(actionContext)}
          {pageSizeControl}
        </div>
      ) : null
    ) : null

  return (
    <div
      className={cn(
        props.fillHeight
          ? 'flex min-h-0 flex-1 flex-col gap-4'
          : 'space-y-4',
      )}
    >
      {topControls}
      {hasRows ? (
        <div
          className={cn(
            'flex min-h-0 flex-col gap-4',
            props.fillHeight && 'flex-1',
          )}
        >
          <div
            className={
              props.fillHeight
                ? ADMIN_TABLE_FILL_VIEWPORT_CLASS_NAME
                : ADMIN_TABLE_VIEWPORT_CLASS_NAME
            }
          >
            {props.renderTable(renderContext)}
          </div>

          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {m.admin_table_pagination_summary({
                page: String(currentPage),
                total_pages: String(pageCount),
                total_count: String(props.rows.length),
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => {
                  setPage((current) => Math.max(1, current - 1))
                }}
              >
                <ChevronLeftIcon />
                {m.ui_previous()}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage >= pageCount}
                onClick={() => {
                  setPage((current) => Math.min(pageCount, current + 1))
                }}
              >
                {m.ui_next()}
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        props.emptyState
      )}
    </div>
  )
}

export function ClientFilterableAdminTable<
  TData,
  TColumns extends ReadonlyArray<ColumnConfig<TData, any, any, any>>,
>(props: {
  data: TData[]
  columnsConfig: TColumns
  defaultFilters?: FiltersState
  getRowId: (row: TData) => string
  emptyState: ReactNode
  renderTable: (context: AdminTableRenderContext<TData>) => ReactNode
  renderActions?: (context: AdminTableActionContext<TData>) => ReactNode
  fillHeight?: boolean
  pageSizeOptions?: readonly number[]
}) {
  const table = useAdminDataTableFilters({
    strategy: 'client',
    data: props.data,
    columnsConfig: props.columnsConfig,
    defaultFilters: props.defaultFilters,
  })

  if (props.data.length === 0) {
    return props.emptyState
  }

  return (
    <AdminPaginatedTable
      rows={table.rows}
      getRowId={props.getRowId}
      emptyState={<FilteredAdminTableEmptyState />}
      toolbar={<AdminDataTableFilterBar table={table} />}
      renderActions={props.renderActions}
      renderTable={props.renderTable}
      resetPageKey={JSON.stringify(table.filters)}
      fillHeight={props.fillHeight}
      pageSizeOptions={props.pageSizeOptions}
    />
  )
}
