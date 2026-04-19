const fs = require('fs');

const path = 'src/app/patients/[id]/page.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add state variable
content = content.replace(
    /const \[blockedFoodDialog, setBlockedFoodDialog\] = [^\n]*\n/, 
    ''
); // clear if it exists
const stateAnchor = 'const [weekCopyDialogData, setWeekCopyDialogData] = useState<{ open: boolean, week: DietWeek } | null>(null)';
content = content.replace(stateAnchor, stateAnchor + '\n    const [blockedFoodDialog, setBlockedFoodDialog] = useState<{ open: boolean, food: any | null, dropData: any | null, reason: string | null }>({ open: false, food: null, dropData: null, reason: null })');

// 2. Add insertMealToDB and update handleDragEnd
const insertLogic = `
    async function insertMealToDB(food: any, dropData: any) {
        if (!food || !dropData) return
        const { data: existingMeals } = await supabase
            .from('diet_meals')
            .select('sort_order')
            .eq('diet_day_id', dropData.dayId)
            .eq('meal_time', dropData.mealTime)
            .order('sort_order', { ascending: false })
            .limit(1)

        const nextOrder = (existingMeals?.[0]?.sort_order || 0) + 1

        const { data: insertedData, error } = await supabase.from('diet_meals').insert([{
            diet_day_id: dropData.dayId,
            food_id: food.id,
            meal_time: dropData.mealTime,
            portion_multiplier: 1,
            sort_order: nextOrder,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            is_consumed: true
        }]).select()

        if (error) {
            console.error("DB INSERT ERROR:", error)
            alert(\`Hata: \${error.message}\`)
        } else {
            setRefreshTrigger(prev => prev + 1)
        }
    }

    async function handleDragEnd(event: DragEndEvent) {
        setActiveDragFood(null) // Clear the drag overlay
        handleResizeUp() // Ensure resize stops too if drag ends (safety)

        const { active, over } = event
        if (!over) return

        const activeType = active.data.current?.type
        const dropType = over.data.current?.type

        if (activeType === 'food' && dropType === 'meal-slot') {
            const food = active.data.current?.food
            const dropData = over.data.current

            if (!food || !dropData) return

            // Check Restrictions
            const compatibility = checkCompatibility(food, activeDietRules)
            if (!compatibility.compatible && compatibility.severity === 'block') {
                setBlockedFoodDialog({ open: true, food, dropData, reason: compatibility.reason })
                return
            }

            await insertMealToDB(food, dropData)
        }
    }`;

// Use regex to locate handleDragEnd and carefully replace it
const dragEndRegex = /async function handleDragEnd\b[\s\S]*?if \(!patient\) return <div className="p-8">Hasta bulunamad\u0131\.<\/div>/;
content = content.replace(dragEndRegex, insertLogic + '\n\n    if (loading) return <div className="p-8">Yükleniyor...</div>\n    if (!patient) return <div className="p-8">Hasta bulunamadı.</div>');


// 3. Add Dialog component to JSX
const dialogJSX = `
            <Dialog open={blockedFoodDialog.open} onOpenChange={(open) => setBlockedFoodDialog(prev => ({ ...prev, open }))}>
                <DialogContent className="max-w-md bg-white p-0 border-0 shadow-2xl rounded-2xl overflow-hidden">
                    <div className="bg-red-50 p-6 text-center border-b border-red-100 flex flex-col items-center">
                        <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mb-4 shadow-sm">
                            <AlertTriangle className="text-red-600 w-8 h-8" />
                        </div>
                        <DialogTitle className="text-xl font-black text-red-700 uppercase tracking-wider">
                            Bu Yemek Engellendi!
                        </DialogTitle>
                    </div>
                    <div className="p-6">
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                            <p className="text-[14px] text-gray-700 font-medium leading-relaxed">
                                {blockedFoodDialog.reason}
                            </p>
                        </div>
                    </div>
                    <div className="px-6 pb-6 flex gap-3">
                        <Button
                            variant="outline"
                            className="flex-1 h-12 rounded-xl text-gray-700 hover:bg-gray-50 border-gray-300 transition-colors"
                            onClick={() => setBlockedFoodDialog({ open: false, food: null, dropData: null, reason: null })}
                        >
                            <X className="w-4 h-4 mr-2 opacity-70" />
                            İptal
                        </Button>
                        <Button
                            variant="destructive"
                            className="flex-1 h-12 rounded-xl shadow-md hover:shadow-lg transition-all"
                            onClick={async () => {
                                await insertMealToDB(blockedFoodDialog.food, blockedFoodDialog.dropData);
                                setBlockedFoodDialog({ open: false, food: null, dropData: null, reason: null });
                            }}
                        >
                            <Check className="w-5 h-5 mr-2 opacity-90" />
                            Yine de Ekle
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>`;

content = content.replace(/<DndContext onDragStart=\{handleDragStart\} onDragEnd=\{handleDragEnd\}>/, dialogJSX);

fs.writeFileSync(path, content);
console.log("File updated successfully.");
