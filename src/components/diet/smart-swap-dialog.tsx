
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ArrowLeftRight, Check, X } from "lucide-react"

interface SmartSwapDialogProps {
    isOpen: boolean
    onClose: () => void
    onConfirmSingle: () => void
    onConfirmAll: () => void
    matchCount: number
    slotName: string
    newFoodName: string
    oldFoodName: string
}

export function SmartSwapDialog({
    isOpen,
    onClose,
    onConfirmSingle,
    onConfirmAll,
    matchCount,
    slotName,
    newFoodName,
    oldFoodName
}: SmartSwapDialogProps) {
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <div className="p-2 bg-emerald-100 rounded-full text-emerald-600">
                            <ArrowLeftRight size={20} />
                        </div>
                        Toplu Değişiklik?
                    </DialogTitle>
                    <DialogDescription className="pt-3 text-base space-y-3" asChild>
                        <div>
                            <div>
                                Değiştirmek istediğiniz yemek (<strong>{oldFoodName}</strong>), bu hafta içinde
                                <span className="font-bold text-emerald-600 mx-1">{matchCount} kez</span>
                                (<strong>{slotName}</strong>) öğününde kullanılıyor.
                            </div>
                            <div className="text-gray-500 text-sm">
                                Diğer günlerdeki aynı öğünleri de <strong>{newFoodName}</strong> ile değiştirmek ister misiniz?
                            </div>
                        </div>
                    </DialogDescription>
                </DialogHeader>

                <DialogFooter className="gap-2 sm:gap-0 mt-4">
                    <Button variant="ghost" onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={16} className="mr-2" />
                        İptal
                    </Button>

                    <Button variant="outline" onClick={onConfirmSingle} className="border-gray-300 text-gray-700 hover:bg-gray-50">
                        Sadece Bunu Değiştir
                    </Button>

                    <Button onClick={onConfirmAll} className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200">
                        <Check size={16} className="mr-2" />
                        Hepsini Değiştir ({matchCount})
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
