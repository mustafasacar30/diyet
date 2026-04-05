
import { createBrowserClient } from '@supabase/ssr'
import { navigatorLock, type LockFunc } from '@supabase/auth-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ''

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase credentials missing! Please check .env.local')
}

const safeAuthLock: LockFunc = async <R>(
    name: string,
    acquireTimeout: number,
    fn: () => Promise<R>
): Promise<R> => {
    const noOpLock: LockFunc = async <T>(_name: string, _timeout: number, lockFn: () => Promise<T>) => lockFn()
    const hasNavigatorLocks =
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as any).navigator !== 'undefined' &&
        typeof (globalThis as any).navigator?.locks?.request === 'function'

    if (hasNavigatorLocks) {
        try {
            const effectiveTimeout = acquireTimeout > 0 ? Math.max(acquireTimeout, 30000) : acquireTimeout
            return await navigatorLock(name, effectiveTimeout, fn)
        } catch (error: any) {
            const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase()
            // Some Chromium builds can throw noisy lock Abort/Timeout errors.
            // Fall back to a local no-op lock to avoid console spam loops.
            if (error?.isAcquireTimeout || text.includes('abort') || text.includes('timeout')) {
                return noOpLock(name, acquireTimeout, fn)
            }
            throw error
        }
    }

    return noOpLock(name, acquireTimeout, fn)
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        lock: safeAuthLock,
    },
})
