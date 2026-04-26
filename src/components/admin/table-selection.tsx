'use client'

import { useEffect, useMemo, useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { TableCell, TableHead } from '#/components/ui/table'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export type AdminTableSelection<TData> = {
  rowCount: number
  selectedCount: number
  selectedIds: string[]
  selectedRows: TData[]
  allSelected: boolean
  partiallySelected: boolean
  isSelected: (row: TData) => boolean
  setRowSelected: (row: TData, selected: boolean) => void
  toggleRow: (row: TData) => void
  setRowsSelected: (rows: TData[], selected: boolean) => void
  getRowsCheckedState: (rows: TData[]) => boolean | 'indeterminate'
  selectAll: () => void
  clear: () => void
  invert: () => void
}

export function useAdminTableSelection<TData>(params: {
  rows: TData[]
  getRowId: (row: TData) => string
}): AdminTableSelection<TData> {
  const rowIds = useMemo(
    () => params.rows.map((row) => params.getRowId(row)),
    [params.getRowId, params.rows],
  )
  const rowIdsKey = rowIds.join('|')
  const rowIdSet = useMemo(() => new Set(rowIds), [rowIdsKey])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => rowIdSet.has(id)))
  }, [rowIdSet])

  const selectedRows = useMemo(
    () => params.rows.filter((row) => selectedIdSet.has(params.getRowId(row))),
    [params.getRowId, params.rows, selectedIdSet],
  )

  function setRowSelected(row: TData, selected: boolean) {
    const rowId = params.getRowId(row)

    setSelectedIds((current) => {
      const nextSelectedIds = new Set(current)

      if (selected) {
        nextSelectedIds.add(rowId)
      } else {
        nextSelectedIds.delete(rowId)
      }

      return rowIds.filter((id) => nextSelectedIds.has(id))
    })
  }

  function toggleRow(row: TData) {
    setRowSelected(row, !selectedIdSet.has(params.getRowId(row)))
  }

  function setRowsSelected(rows: TData[], selected: boolean) {
    const targetIds = rows.map((row) => params.getRowId(row))

    setSelectedIds((current) => {
      const nextSelectedIds = new Set(current)

      for (const rowId of targetIds) {
        if (selected) {
          nextSelectedIds.add(rowId)
        } else {
          nextSelectedIds.delete(rowId)
        }
      }

      return rowIds.filter((id) => nextSelectedIds.has(id))
    })
  }

  function getRowsCheckedState(rows: TData[]) {
    if (!rows.length) {
      return false
    }

    const selectedCount = rows.filter((row) =>
      selectedIdSet.has(params.getRowId(row)),
    ).length

    if (selectedCount === 0) {
      return false
    }

    return selectedCount === rows.length ? true : 'indeterminate'
  }

  return {
    rowCount: rowIds.length,
    selectedCount: selectedIds.length,
    selectedIds,
    selectedRows,
    allSelected: rowIds.length > 0 && selectedIds.length === rowIds.length,
    partiallySelected:
      selectedIds.length > 0 && selectedIds.length < rowIds.length,
    isSelected: (row) => selectedIdSet.has(params.getRowId(row)),
    setRowSelected,
    toggleRow,
    setRowsSelected,
    getRowsCheckedState,
    selectAll: () => {
      setSelectedIds(rowIds)
    },
    clear: () => {
      setSelectedIds([])
    },
    invert: () => {
      setSelectedIds((current) => {
        const currentIds = new Set(current)
        return rowIds.filter((id) => !currentIds.has(id))
      })
    },
  }
}

export function AdminTableSelectionToolbar<TData>(props: {
  selection: AdminTableSelection<TData>
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', props.className)}>
      <Badge variant="outline">
        {m.admin_table_selection_summary({
          count: String(props.selection.selectedCount),
        })}
      </Badge>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!props.selection.rowCount || props.selection.allSelected}
        onClick={() => {
          props.selection.selectAll()
        }}
      >
        {m.admin_table_selection_select_all()}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!props.selection.selectedCount}
        onClick={() => {
          props.selection.clear()
        }}
      >
        {m.admin_table_selection_clear()}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!props.selection.rowCount}
        onClick={() => {
          props.selection.invert()
        }}
      >
        {m.admin_table_selection_invert()}
      </Button>
    </div>
  )
}

export function AdminTableSelectionHead<TData>(props: {
  rows: TData[]
  selection: AdminTableSelection<TData>
  className?: string
}) {
  return (
    <TableHead className={cn('w-10', props.className)}>
      <Checkbox
        checked={props.selection.getRowsCheckedState(props.rows)}
        aria-label={m.admin_table_selection_select_page()}
        onCheckedChange={(checked) => {
          props.selection.setRowsSelected(props.rows, checked === true)
        }}
      />
    </TableHead>
  )
}

export function AdminTableSelectionCell<TData>(props: {
  row: TData
  selection: AdminTableSelection<TData>
  className?: string
}) {
  return (
    <TableCell className={cn('w-10 align-top', props.className)}>
      <Checkbox
        checked={props.selection.isSelected(props.row)}
        aria-label={m.admin_table_selection_select_row()}
        onCheckedChange={(checked) => {
          props.selection.setRowSelected(props.row, checked === true)
        }}
      />
    </TableCell>
  )
}
