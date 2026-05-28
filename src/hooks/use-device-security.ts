import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const DEVICE_ID_KEY = 'diet_app_device_id'

export function useDeviceSecurity() {
    const [deviceId, setDeviceId] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    // 1. Initialize / Get Device ID
    useEffect(() => {
        if (typeof window !== 'undefined') {
            let id = localStorage.getItem(DEVICE_ID_KEY)
            if (!id) {
                // Use native crypto API or fallback
                id = window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36)
                localStorage.setItem(DEVICE_ID_KEY, id)
            }
            setDeviceId(id)
        }
    }, [])

    // 2. Register Device Function
    const registerDevice = async () => {
        if (!deviceId) return { success: false, message: 'Device ID not ready' }

        setLoading(true)
        try {
            const userAgent = window.navigator.userAgent
            // Simple logic to guess device name
            let deviceName = 'Unknown Device'
            if (userAgent.includes('Mobile')) deviceName = 'Mobile Device'
            else if (userAgent.includes('Windows')) deviceName = 'Windows PC'
            else if (userAgent.includes('Mac')) deviceName = 'Mac'
            else if (userAgent.includes('Linux')) deviceName = 'Linux PC'

            // Call RPC
            const { data, error } = await supabase.rpc('register_device', {
                _device_id: deviceId,
                _device_name: deviceName
            })

            if (error) {
                console.error("Device verification failed:", error)
                // If specific limit error
                if (error.message.includes('Device limit reached')) {
                    return { success: false, code: 'LIMIT_EXCEEDED', message: 'Cihaz limitiniz doldu. Lütfen yöneticinizle iletişime geçin.' }
                }
                // If RLS error, bypass it so patients can log in even if device table is restricted
                if (error.code === '42501' || error.message.includes('row-level security policy')) {
                    console.warn("Ignoring RLS error on user_devices to allow login.");
                    return { success: true };
                }
                return { success: false, message: error.message }
            }

            return { success: true }
        } catch (err: any) {
            console.error("Device registration error:", err)
            return { success: false, message: err.message }
        } finally {
            setLoading(false)
        }
    }

    return {
        deviceId,
        registerDevice,
        loading
    }
}
