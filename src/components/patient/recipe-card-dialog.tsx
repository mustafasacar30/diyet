
"use client"

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { X, Download, Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

interface RecipeCardDialogProps {
    isOpen: boolean
    onClose: () => void
    cardUrl: string
    cardName: string
}

export function RecipeCardDialog({ isOpen, onClose, cardUrl, cardName }: RecipeCardDialogProps) {
    const [isDownloading, setIsDownloading] = useState(false);
    const [currentSrcIndex, setCurrentSrcIndex] = useState(0);
    const [imageReady, setImageReady] = useState(false);

    // Migrate legacy repo URLs to the new lipodemmerkezi/zip repo
    const migrateRecipeUrl = (url: string): string => {
        if (!url) return url
        return url
            .replace(
                /raw\.githubusercontent\.com\/mustafasacar35\/lipodem-takip-paneli\//g,
                'raw.githubusercontent.com/lipodemmerkezi/zip/'
            )
            .replace(
                /api\.github\.com\/repos\/mustafasacar35\/lipodem-takip-paneli\//g,
                'api.github.com/repos/lipodemmerkezi/zip/'
            )
    }

    const resolveRecipeSources = (url: string) => {
        const migrated = migrateRecipeUrl(url)
        const sources: string[] = []
        const rawGithub = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
        const m = migrated.match(rawGithub)
        if (m) {
            const [, owner, repo, branch, path] = m
            sources.push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`)
        }
        sources.push(migrated)
        return Array.from(new Set(sources))
    }

    const candidateSources = useMemo(() => resolveRecipeSources(cardUrl), [cardUrl])
    const activeSrc = candidateSources[Math.min(currentSrcIndex, candidateSources.length - 1)] || cardUrl

    useEffect(() => {
        if (!isOpen) return
        setCurrentSrcIndex(0)
        setImageReady(false)
    }, [isOpen, cardUrl])

    const handleDownload = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (isDownloading) return;
        setIsDownloading(true);

        try {
            const response = await fetch(migrateRecipeUrl(cardUrl));
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            // Provide a sensible default extension if missing
            a.download = cardName.includes('.') ? cardName : `${cardName}.webp`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error('Failed to download image', err);
            // Fallback: Just open image in new tab if blob fetch fails (e.g., CORS issue)
            window.open(migrateRecipeUrl(cardUrl), '_blank');
        } finally {
            setIsDownloading(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent
                showCloseButton={false}
                className="max-w-[100vw] max-h-[100dvh] w-auto h-auto p-0 border-none bg-transparent shadow-none flex flex-col items-center outline-none"
            >
                <DialogTitle className="sr-only">{cardName}</DialogTitle>
                <DialogDescription className="sr-only">
                    {cardName} tarif kartı görseli
                </DialogDescription>
                {/* Close Button - Floating top right */}
                <button
                    onClick={onClose}
                    className="absolute top-2 right-2 z-50 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-all backdrop-blur-sm"
                >
                    <X className="h-6 w-6" />
                </button>

                {/* Save Button - Floating bottom right */}
                <button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="absolute bottom-4 right-4 z-50 bg-emerald-600/90 hover:bg-emerald-700 text-white rounded-full p-3 transition-all backdrop-blur-sm shadow-xl flex items-center justify-center font-medium border border-emerald-400/30 group"
                >
                    {isDownloading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                        <Download className="h-5 w-5 group-hover:scale-110 transition-transform" />
                    )}
                </button>

                {/* Image drives the size */}
                {!imageReady && (
                    <div className="w-[80vw] max-w-[720px] h-[60vh] max-h-[900px] rounded-xl bg-black/30 backdrop-blur-sm flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-white/90" />
                    </div>
                )}
                <img
                    src={activeSrc}
                    alt={cardName}
                    className={`max-w-[100vw] max-h-[100dvh] w-auto h-auto object-contain shadow-2xl ${imageReady ? "block" : "hidden"}`}
                    onLoad={() => setImageReady(true)}
                    onError={() => {
                        if (currentSrcIndex < candidateSources.length - 1) {
                            setCurrentSrcIndex((prev) => prev + 1)
                            return
                        }
                        setImageReady(true)
                    }}
                />
            </DialogContent>
        </Dialog>
    )
}
