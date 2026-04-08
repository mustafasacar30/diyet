"use client"

import { useEffect, useMemo, useState } from "react"

type AppStartupLoaderProps = {
    displayName?: string | null
    title?: string
    subtitle?: string
    overlay?: boolean
    keepBottomNavVisible?: boolean
}

function getFirstName(displayName?: string | null): string | null {
    if (!displayName) return null
    const trimmed = displayName.trim()
    if (!trimmed) return null
    return trimmed.split(/\s+/)[0] || null
}

const ASSET_VERSION = "20260316c"
const CRITICAL_ASSETS = [
    // LITE VERSIONS FOR MOBILE APP STARTUP PERFORMANCE AND REDUCED BUNDLE SIZE
    `/kapak-lite.jpg?v=${ASSET_VERSION}`,
    // Critical preloads
    '/_next/static/css/app/layout.css',
    // We can add font here if desired, but browser handles it well usually
    `/logo-lite.png?v=${ASSET_VERSION}`
]

const COVER_CANDIDATES = [
    `/kapak-lite.jpg?v=${ASSET_VERSION}`
]
const LOGO_CANDIDATES = [
    `/logo-lite.png?v=${ASSET_VERSION}`
]

export default function AppStartupLoader({
    displayName,
    title = "Uygulama yukleniyor",
    subtitle,
    overlay = false,
    keepBottomNavVisible = false
}: AppStartupLoaderProps) {
    const [messageIndex, setMessageIndex] = useState(0)
    const [coverIndex, setCoverIndex] = useState(0)
    const [logoIndex, setLogoIndex] = useState(0)
    const [coverFailed, setCoverFailed] = useState(false)
    const [logoFailed, setLogoFailed] = useState(false)
    const firstName = getFirstName(displayName)

    const messages = useMemo(() => {
        const base = [
            "Guvenli baglanti kuruluyor...",
            "Profil bilgileri hazirlaniyor...",
            "Menu verileri eslestiriliyor...",
            "Kisisel plan alaniniz aciliyor..."
        ]

        if (!firstName) return base
        return [
            `Merhaba ${firstName}, hos geldiniz.`,
            ...base
        ]
    }, [firstName])

    useEffect(() => {
        const messageInterval = window.setInterval(() => {
            setMessageIndex((prev) => (prev + 1) % messages.length)
        }, 1800)

        return () => window.clearInterval(messageInterval)
    }, [messages.length])

    return (
        <div
            className={
                overlay
                    ? `fixed inset-0 overflow-hidden bg-slate-950 ${keepBottomNavVisible ? "z-40" : "z-[80]"}`
                    : "relative min-h-screen w-full overflow-hidden bg-slate-950"
            }
        >
            {!coverFailed && (
                <img
                    src={COVER_CANDIDATES[coverIndex]}
                    alt=""
                    aria-hidden="true"
                    fetchPriority="high"
                    decoding="async"
                    onError={() => {
                        if (coverIndex < COVER_CANDIDATES.length - 1) {
                            setCoverIndex((prev) => prev + 1)
                        } else {
                            setCoverFailed(true)
                        }
                    }}
                    className="absolute inset-0 h-full w-full object-cover opacity-100 brightness-110 saturate-110"
                />
            )}
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900/10 via-slate-900/28 to-slate-950/48" />

            <div className="relative z-10 flex min-h-screen items-center justify-center p-5">
                <div className="w-full max-w-md rounded-3xl border border-white/25 bg-slate-900/42 p-6 shadow-[0_20px_70px_rgba(0,0,0,0.32)] backdrop-blur-md">
                    <div className="mx-auto mb-5 h-16 w-16 overflow-hidden rounded-2xl border border-white/25 bg-white/10 p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
                        {!logoFailed ? (
                            <img
                                src={LOGO_CANDIDATES[logoIndex]}
                                alt=""
                                aria-hidden="true"
                                fetchPriority="high"
                                decoding="async"
                                onError={() => {
                                    if (logoIndex < LOGO_CANDIDATES.length - 1) {
                                        setLogoIndex((prev) => prev + 1)
                                    } else {
                                        setLogoFailed(true)
                                    }
                                }}
                                className="h-full w-full object-contain"
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-emerald-200">
                                D
                            </div>
                        )}
                    </div>

                    <h1 className="text-center text-xl font-semibold tracking-tight text-white">
                        {title}
                    </h1>
                    <p className="mt-2 min-h-6 text-center text-sm text-emerald-200/95">
                        {subtitle || messages[messageIndex]}
                    </p>

                    <div className="mt-6 h-2.5 w-full overflow-hidden rounded-full bg-white/25">
                        <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-emerald-200 via-emerald-300 to-cyan-200 opacity-85" />
                    </div>
                </div>
            </div>
        </div>
    )
}
