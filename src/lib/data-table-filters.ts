import type {
  Column,
  FilterModel,
  FiltersState,
} from '#/components/data-table-filter/core/types'
import {
  dateFilterFn,
  multiOptionFilterFn,
  numberFilterFn,
  optionFilterFn,
  textFilterFn,
} from '#/components/data-table-filter/lib/filter-fns'

function coerceDate(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function parseFilterModel(input: unknown): FilterModel | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const candidate = input as {
    columnId?: unknown
    type?: unknown
    operator?: unknown
    values?: unknown
  }

  if (
    typeof candidate.columnId !== 'string' ||
    typeof candidate.type !== 'string' ||
    typeof candidate.operator !== 'string' ||
    !Array.isArray(candidate.values)
  ) {
    return null
  }

  switch (candidate.type) {
    case 'date': {
      const values = candidate.values
        .map((value) => coerceDate(value))
        .filter((value): value is Date => Boolean(value))

      return {
        columnId: candidate.columnId,
        type: candidate.type,
        operator: candidate.operator as FilterModel<'date'>['operator'],
        values,
      }
    }
    case 'number': {
      const values = candidate.values.filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value),
      )

      return {
        columnId: candidate.columnId,
        type: candidate.type,
        operator: candidate.operator as FilterModel<'number'>['operator'],
        values,
      }
    }
    case 'text':
    case 'option':
    case 'multiOption': {
      const values = candidate.values.filter(
        (value): value is string => typeof value === 'string',
      )

      return {
        columnId: candidate.columnId,
        type: candidate.type,
        operator: candidate.operator as
          | FilterModel<'text'>['operator']
          | FilterModel<'option'>['operator']
          | FilterModel<'multiOption'>['operator'],
        values,
      }
    }
    default:
      return null
  }
}

export function serializeDataTableFilters(filters: FiltersState) {
  return JSON.stringify(
    filters.map((filter) => ({
      ...filter,
      values:
        filter.type === 'date'
          ? filter.values.map((value) => value.toISOString())
          : filter.values,
    })),
  )
}

export function deserializeDataTableFilters(
  value: string | null | undefined,
): FiltersState {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.flatMap((filter) => {
      const parsedFilter = parseFilterModel(filter)
      return parsedFilter ? [parsedFilter] : []
    })
  } catch {
    return []
  }
}

export function filterDataTableRows<TData>(
  data: TData[],
  columns: Column<TData>[],
  filters: FiltersState,
) {
  if (filters.length === 0) {
    return data
  }

  return data.filter((row) =>
    filters.every((filter) => {
      const column = columns.find((candidate) => candidate.id === filter.columnId)
      if (!column) {
        return true
      }

      const rawValue = column.accessor(row)

      switch (filter.type) {
        case 'option':
          return optionFilterFn(
            typeof rawValue === 'string' ? rawValue : '',
            filter as FilterModel<'option'>,
          )
        case 'multiOption':
          return multiOptionFilterFn(
            Array.isArray(rawValue)
              ? rawValue.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [],
            filter as FilterModel<'multiOption'>,
          )
        case 'date': {
          const dateValue = coerceDate(rawValue)
          return dateValue
            ? dateFilterFn(dateValue, filter as FilterModel<'date'>)
            : false
        }
        case 'number':
          return numberFilterFn(
            typeof rawValue === 'number' ? rawValue : Number.NaN,
            filter as FilterModel<'number'>,
          )
        case 'text':
          return textFilterFn(
            typeof rawValue === 'string' ? rawValue : '',
            filter as FilterModel<'text'>,
          )
        default:
          return true
      }
    }),
  )
}
