"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'

interface SidebarContextType {
    sidebarWidth: number
    setSidebarWidth: (width: number) => void
    isSidebarCollapsed: boolean
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarProvider({ children, initialWidth = 260 }: { children: React.ReactNode, initialWidth?: number }) {
    const [sidebarWidth, setSidebarWidth] = useState(initialWidth)
    
    useEffect(() => {
        setSidebarWidth(initialWidth)
    }, [initialWidth])

    const isSidebarCollapsed = sidebarWidth <= 60

    return (
        <SidebarContext.Provider value={{ sidebarWidth, setSidebarWidth, isSidebarCollapsed }}>
            {children}
        </SidebarContext.Provider>
    )
}

export function useSidebar() {
    const context = useContext(SidebarContext)
    if (context === undefined) {
        // Safe fallback for server-side rendering (SSR) or when rendered outside SidebarProvider
        return {
            sidebarWidth: 260,
            setSidebarWidth: () => {},
            isSidebarCollapsed: false
        }
    }
    return context
}
