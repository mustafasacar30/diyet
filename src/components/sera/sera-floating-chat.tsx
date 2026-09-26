'use client'

import { useState, useEffect } from 'react'
import { Leaf, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SeraChat } from './sera-chat'

interface SeraFloatingChatProps {
  patientId: string
  patientName?: string
  forceOpen?: boolean
  onClose?: () => void
}

export function SeraFloatingChat({ patientId, patientName, forceOpen, onClose }: SeraFloatingChatProps) {
  const [isOpen, setIsOpen] = useState(forceOpen ?? false)
  const [hasInteracted, setHasInteracted] = useState(false)

  useEffect(() => {
    if (forceOpen !== undefined) setIsOpen(forceOpen)
  }, [forceOpen])

  const handleClose = () => {
    setIsOpen(false)
    onClose?.()
  }

  useEffect(() => {
    if (!forceOpen) {
      const timer = setTimeout(() => setHasInteracted(true), 3000)
      return () => clearTimeout(timer)
    }
  }, [forceOpen])

  return (
    <>
      {/* Floating button — hidden when opened via forceOpen (bottom nav handles it) */}
      {!isOpen && !forceOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 right-4 z-40 group"
        >
          <div className="relative">
            <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" style={{ animationDuration: '2.5s' }} />
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 opacity-0 group-hover:opacity-30 blur-lg transition-opacity duration-500" />
            <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-200/50 flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-active:scale-95">
              <Leaf className="h-6 w-6 text-white" />
            </div>
          </div>
          {!hasInteracted && (
            <div className="absolute right-16 top-1/2 -translate-y-1/2 bg-white rounded-xl px-3 py-2 shadow-lg border border-slate-100 whitespace-nowrap animate-fade-in">
              <p className="text-xs font-medium text-slate-700">Bana sor! 🌿</p>
              <div className="absolute right-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-r border-b border-slate-100 rotate-[-45deg]" />
            </div>
          )}
        </button>
      )}

      {/* Chat modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 sm:flex sm:items-center sm:justify-center sm:p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal — mobile: üstten 2.5rem + safe area, alttan bottom nav üstünde */}
          <div className={cn(
            "absolute left-0 right-0 sm:relative sm:w-full sm:max-w-md bg-white sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden",
            "animate-slide-up sm:animate-scale-in",
            "top-[calc(2.5rem+env(safe-area-inset-top,0px))] bottom-[4.5rem] rounded-t-3xl rounded-b-xl",
            "sm:top-auto sm:bottom-auto sm:h-[600px] sm:max-h-[85dvh]"
          )}>
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-1.5">
                <Leaf className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-bold text-slate-800">Sera</span>
                <span className="text-[10px] text-slate-400">Lipödem asistanınız</span>
              </div>
              <button
                onClick={handleClose}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
              >
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            {/* Chat body */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <SeraChat patientId={patientId} patientName={patientName} embedded />
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateX(8px) translateY(-50%); }
          to { opacity: 1; transform: translateX(0) translateY(-50%); }
        }
        .animate-slide-up { animation: slide-up 0.3s ease-out; }
        .animate-scale-in { animation: scale-in 0.2s ease-out; }
        .animate-fade-in { animation: fade-in 0.5s ease-out 1s both; }
      `}</style>
    </>
  )
}
