'use client'

import { type ReactNode, useMemo } from 'react'

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
import { filterDataTableRows } from '#/lib/data-table-filters'
import { getDataTableFilterLocale } from '#/lib/i18n'
import { m } from '#/paraglide/messages'

type FilterTableOptions<
  TData,
  TColumns extends ReadonlyArray<ColumnConfig<TData, any, any, any>>,
  TStrategy extends FilterStrategy,
> = DataTableFiltersOptions<TData, TColumns, TStrategy>

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

export function ClientFilterableAdminTable<
  TData,
  TColumns extends ReadonlyArray<ColumnConfig<TData, any, any, any>>,
>(props: {
  data: TData[]
  columnsConfig: TColumns
  emptyState: ReactNode
  renderTable: (rows: TData[]) => ReactNode
}) {
  const table = useAdminDataTableFilters({
    strategy: 'client',
    data: props.data,
    columnsConfig: props.columnsConfig,
  })

  if (props.data.length === 0) {
    return props.emptyState
  }

  return (
    <div className="space-y-4">
      <AdminDataTableFilterBar table={table} />
      {table.rows.length > 0 ? (
        props.renderTable(table.rows)
      ) : (
        <FilteredAdminTableEmptyState />
      )}
    </div>
  )
}
