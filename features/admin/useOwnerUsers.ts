import { useCallback, useEffect, useState } from 'react'
import { searchOwnerUsers, type OwnerAccessFilter, type OwnerUserRow, type OwnerUserSort } from './adminService'

export const OWNER_USERS_PAGE_SIZE = 25

export function useOwnerUsers() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [access, setAccessState] = useState<OwnerAccessFilter | null>(null)
  const [sort, setSortState] = useState<OwnerUserSort>('signup')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<OwnerUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQuery(query); setPage(0) }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const refresh = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const result = await searchOwnerUsers({ search: debouncedQuery, access, sort, limit: OWNER_USERS_PAGE_SIZE, offset: page * OWNER_USERS_PAGE_SIZE })
      setRows(result.rows); setTotal(result.total)
      return result.rows
    } catch (e) {
      console.error('[owner.users]', e); setFailed(true)
      return []
    } finally { setLoading(false) }
  }, [debouncedQuery, access, sort, page])

  useEffect(() => { void refresh() }, [refresh])

  const setAccess = (value: OwnerAccessFilter | null) => { setAccessState(value); setPage(0) }
  const setSort = (value: OwnerUserSort) => { setSortState(value); setPage(0) }

  return { query, setQuery, access, setAccess, sort, setSort, page, setPage, rows, total, loading, failed, refresh }
}
