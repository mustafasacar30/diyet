"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Plus, Trash2, Pencil, Check, X, GripHorizontal, Image as ImageIcon, Search } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { supabase } from "@/lib/supabase"
import { Textarea } from "@/components/ui/textarea"
import { Label as ShcnLabel } from "@/components/ui/label"
import { createPatientWithAuth } from "@/actions/patient-actions"
import { useAuth } from "@/contexts/auth-context"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import LabResultsGrid from "./LabResultsGrid"
import PatientNotesEditor from "./PatientNotesEditor"
import { Camera, ClipboardList, Phone, Target } from "lucide-react"
import { MultiSelectCreatable } from "@/components/ui/multi-select-creatable"

// Draggable Dialog Wrapper
function DraggableDialogContent({ children, className, ...props }: React.ComponentPropsWithoutRef<typeof DialogContent>) {
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null)

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        setIsDragging(true)
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            initialX: position.x,
            initialY: position.y
        }
    }, [position])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging || !dragRef.current) return
            const dx = e.clientX - dragRef.current.startX
            const dy = e.clientY - dragRef.current.startY
            setPosition({
                x: dragRef.current.initialX + dx,
                y: dragRef.current.initialY + dy
            })
        }

        const handleMouseUp = () => {
            setIsDragging(false)
            dragRef.current = null
        }

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging])

    return (
        <DialogContent
            className={`!top-[5%] !translate-y-0 ${className}`}
            style={{
                marginLeft: position.x,
                marginTop: position.y
            }}
            {...props}
        >
            <div
                className="absolute top-0 left-0 right-12 h-10 cursor-move flex items-center justify-center"
                onMouseDown={handleMouseDown}
            >
                <GripHorizontal className="h-4 w-4 text-gray-300" />
            </div>
            {children}
        </DialogContent>
    )
}


const profileSchema = z.object({
    // Auth fields (only for create mode)
    email: z.string().email("Geçerli e-posta girin").optional().or(z.literal("")),
    password: z.string().min(6, "Şifre en az 6 karakter").optional().or(z.literal("")),
    // Profile fields
    full_name: z.string().min(2, "İsim en az 2 karakter olmalı"),
    age: z.coerce.number().optional(),
    height: z.coerce.number().optional(),
    weight: z.coerce.number().optional(),
    gender: z.enum(["male", "female"]).optional(),
    activity_level: z.coerce.number().optional(),
    liked_foods: z.string().optional(),
    disliked_foods: z.string().optional(),
    phone: z.string().optional(),
    patient_goals: z.array(z.string()).optional(),
    program_template_id: z.string().optional().nullable(),
    max_future_weeks: z.coerce.number().optional(),
    max_past_weeks: z.coerce.number().optional(),
    allow_past: z.boolean().default(false).optional(),
    allow_future: z.boolean().default(false).optional(),
    show_flavor_tune: z.boolean().default(false).optional(),
    macro_target_mode: z.enum(["calculated", "plan"]).default("calculated").optional(),
    allow_program_selection: z.boolean().nullable().optional(), // null means use global
    allow_goal_selection: z.boolean().nullable().optional(), // null means use global
    allow_week_delete: z.boolean().nullable().optional(), // null means use global
    auto_plan_limit_count: z.coerce.number().nullable().optional(),
    auto_plan_limit_period_hours: z.coerce.number().nullable().optional(),
    ai_analysis_limit_count: z.coerce.number().nullable().optional(),
    ai_analysis_limit_period_hours: z.coerce.number().nullable().optional(),
    ai_photo_limit_count: z.coerce.number().nullable().optional(),
    ai_photo_limit_period_hours: z.coerce.number().nullable().optional(),
    ai_search_limit_count: z.coerce.number().nullable().optional(),
    ai_search_limit_period_hours: z.coerce.number().nullable().optional(),
})

interface PatientProfileDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    patientId?: string | null  // null for create mode
    mode?: "create" | "edit"  // default: edit
    activeWeekId?: string | null
    onSuccess?: (patientId?: string) => void
    onUpdate?: () => void  // Callback when lab data changes
}

export function PatientProfileDialog({
    open,
    onOpenChange,
    patientId,
    mode = "edit",
    activeWeekId,
    onSuccess,
    onUpdate
}: PatientProfileDialogProps) {
    const [loading, setLoading] = useState(false)
    const { user } = useAuth()
    const isDietitian = true // Assuming admin/dietitian view for this dialog
    const [error, setError] = useState<string | null>(null)
    const [diseases, setDiseases] = useState<{ id: string, name: string }[]>([])
    const [selectedDiseaseIds, setSelectedDiseaseIds] = useState<string[]>([])
    const [programs, setPrograms] = useState<any[]>([])

    // Log Tracking States
    const [activityLogs, setActivityLogs] = useState<any[]>([])
    const [isLoadingLogs, setIsLoadingLogs] = useState(false)

    const fetchActivityLogs = async () => {
        if (!patientId) return
        setIsLoadingLogs(true)
        try {
            const { data, error } = await supabase
                .from('patient_activity_logs')
                .select('*')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false })
                .limit(50)
            if (error) throw error
            setActivityLogs(data || [])
        } catch (err: any) {
            console.error("Error fetching logs:", err)
        } finally {
            setIsLoadingLogs(false)
        }
    }

    useEffect(() => {
        if (open && patientId) {
            fetchActivityLogs()
        }
    }, [open, patientId])

    // Medications State
    const [medications, setMedications] = useState<{ id: string, name: string, generic_name: string | null }[]>([])
    const [selectedMedicationIds, setSelectedMedicationIds] = useState<string[]>([])
    const [medSearchTerm, setMedSearchTerm] = useState('')
    const [showMedDropdown, setShowMedDropdown] = useState(false)
    const [isAddingMed, setIsAddingMed] = useState(false)

    // Global Settings State
    const [globalSettings, setGlobalSettings] = useState({
        allow_program_selection: false,
        allow_goal_selection: false,
        allow_week_delete: false
    })

    // Goals State
    const GOAL_OPTIONS: { id: string, name: string }[] = [
        { id: "Kilo Vermek", name: "Kilo Vermek" },
        { id: "Kilo Almak", name: "Kilo Almak" },
        { id: "Kilo Korumak", name: "Kilo Korumak" },
        { id: "Detoks", name: "Detoks" },
        { id: "Eliminasyon", name: "Eliminasyon" },
        { id: "Lipödem Beslenmesi", name: "Lipödem Beslenmesi" },
        { id: "Gebelik Beslenmesi", name: "Gebelik Beslenmesi" },
        { id: "Emzirme Beslenmesi", name: "Emzirme Beslenmesi" },
        { id: "Kas Gelişimi (Hipertrofi)", name: "Kas Gelişimi (Hipertrofi)" },
        { id: "Sağlıklı Yaşam", name: "Sağlıklı Yaşam" },
        { id: "Sporcu Beslenmesi", name: "Sporcu Beslenmesi" }
    ]
    const [selectedGoals, setSelectedGoals] = useState<{ id: string, name: string }[]>([])


    // Micronutrient & Labs State
    const [activeTab, setActiveTab] = useState<"profile" | "labs">("profile")
    const [micronutrientList, setMicronutrientList] = useState<any[]>([])
    const [labResults, setLabResults] = useState<any[]>([])
    const [editingLabId, setEditingLabId] = useState<string | null>(null)
    const [editLabData, setEditLabData] = useState({ value: '', ref_min: '', ref_max: '' })
    const [newLabEntry, setNewLabEntry] = useState({ micronutrient_id: '', value: '', ref_min: '', ref_max: '', date: new Date().toISOString().split('T')[0] })

    const isCreateMode = mode === 'create' || !patientId

    useEffect(() => {
        if (open) {
            fetchPrograms()
            fetchDiseases()
            fetchMicronutrients()
            fetchMedications()
            fetchGlobalSettings()
            if (patientId) fetchLabResults()
        }
    }, [open, patientId])

    async function fetchGlobalSettings() {
        const { data } = await supabase
            .from('diet_app_settings')
            .select('value')
            .eq('id', 'registration_settings')
            .single()

        if (data && data.value) {
            setGlobalSettings({
                allow_program_selection: !!data.value.allow_program_selection,
                allow_goal_selection: !!data.value.allow_goal_selection,
                allow_week_delete: !!data.value.allow_week_delete
            })
        }
    }

    async function fetchMicronutrients() {
        const { data } = await supabase.from('micronutrients').select('*').order('name')
        if (data) setMicronutrientList(data)
    }

    async function fetchLabResults() {
        const { data } = await supabase
            .from('patient_lab_results')
            .select('*, micronutrients(name, unit)')
            .eq('patient_id', patientId)
            .order('measured_at', { ascending: false })
        if (data) setLabResults(data)
    }

    async function handleAddLabResult() {
        if (!newLabEntry.micronutrient_id || !newLabEntry.value) return

        const { error } = await supabase.from('patient_lab_results').insert({
            patient_id: patientId,
            micronutrient_id: newLabEntry.micronutrient_id,
            value: parseFloat(newLabEntry.value),
            ref_min: newLabEntry.ref_min ? parseFloat(newLabEntry.ref_min) : null,
            ref_max: newLabEntry.ref_max ? parseFloat(newLabEntry.ref_max) : null,
            measured_at: newLabEntry.date
        })

        if (!error) {
            setNewLabEntry({ ...newLabEntry, value: '', ref_min: '', ref_max: '' })
            fetchLabResults()
            if (onUpdate) onUpdate()
        }
    }

    async function handleDeleteLabResult(id: string) {
        if (!confirm("Tahlil sonucunu silmek istediğinize emin misiniz?")) return
        const { error } = await supabase.from('patient_lab_results').delete().eq('id', id)
        if (!error) {
            fetchLabResults()
            if (onUpdate) onUpdate()
        }
    }

    function startEditLab(lab: any) {
        setEditingLabId(lab.id)
        setEditLabData({
            value: lab.value.toString(),
            ref_min: lab.ref_min?.toString() || '',
            ref_max: lab.ref_max?.toString() || ''
        })
    }

    async function handleUpdateLabResult(id: string) {
        const { error } = await supabase.from('patient_lab_results').update({
            value: parseFloat(editLabData.value),
            ref_min: editLabData.ref_min ? parseFloat(editLabData.ref_min) : null,
            ref_max: editLabData.ref_max ? parseFloat(editLabData.ref_max) : null
        }).eq('id', id)

        if (!error) {
            setEditingLabId(null)
            fetchLabResults()
            if (onUpdate) onUpdate()
        }
    }

    async function fetchDiseases() {
        try {
            const { data, error } = await supabase
                .from('diseases')
                .select('id, name')
                .order('name')
            if (data) setDiseases(data)
        } catch (e) {
            console.error("Error fetching diseases", e)
        }
    }

    async function fetchMedications() {
        try {
            const { data, error } = await supabase
                .from('medications')
                .select('id, name, generic_name')
                .order('name')
            if (data) setMedications(data)
        } catch (e) {
            console.error("Error fetching medications", e)
        }
    }

    async function fetchPrograms() {
        // Program şablonlarını çek
        try {
            const { data, error } = await supabase
                .from('program_templates')
                .select('id, name, program_template_weeks(week_start, week_end, diet_type_id)')
                .eq('is_active', true)
                .order('name')

            if (!error && data) {
                setPrograms(data)
            }
        } catch (e) {
            // Tablo henüz yoksa sessizce geç
            console.log('Programs fetch error (table might be missing):', e)
        }
    }


    const form = useForm({
        resolver: zodResolver(profileSchema),
        defaultValues: {
            email: "",
            password: "",
            full_name: "",
            age: 0,
            height: 0,
            weight: 0,
            gender: "male",
            activity_level: 3,
            liked_foods: "",
            disliked_foods: "",
            phone: "",
            patient_goals: [],
            program_template_id: null,
            max_future_weeks: 2,
            max_past_weeks: 2,
            allow_past: false,
            allow_future: false,
            show_flavor_tune: false,
            macro_target_mode: "calculated",
            allow_program_selection: null as boolean | null,
            allow_goal_selection: null as boolean | null,
            allow_week_delete: null as boolean | null,
            auto_plan_limit_count: null as number | null,
            auto_plan_limit_period_hours: null as number | null,
            ai_analysis_limit_count: null as number | null,
            ai_analysis_limit_period_hours: null as number | null,
            ai_photo_limit_count: null as number | null,
            ai_photo_limit_period_hours: null as number | null,
            ai_search_limit_count: null as number | null,
            ai_search_limit_period_hours: null as number | null,
        },
    })

    useEffect(() => {
        if (open) {
            if (isCreateMode) {
                // Reset form for create mode
                form.reset({
                    email: "",
                    password: "",
                    full_name: "",
                    age: 0,
                    height: 0,
                    weight: 0,
                    gender: "male",
                    activity_level: 3,
                    liked_foods: "",
                    disliked_foods: "",
                    program_template_id: null,
                    max_future_weeks: 2,
                    max_past_weeks: 2,
                    allow_past: false,
                    allow_future: false,
                    show_flavor_tune: false,
                    macro_target_mode: "calculated",
                    allow_program_selection: null,
                    allow_goal_selection: null,
                    allow_week_delete: null,
                    auto_plan_limit_count: null,
                    auto_plan_limit_period_hours: null,
                    ai_analysis_limit_count: null,
                    ai_analysis_limit_period_hours: null,
                    ai_photo_limit_count: null,
                    ai_photo_limit_period_hours: null,
                    ai_search_limit_count: null,
                    ai_search_limit_period_hours: null,
                })
                setSelectedDiseaseIds([])
                setSelectedMedicationIds([])
                setError(null)
            } else if (patientId) {
                loadPatientData()
            }
        }
    }, [open, patientId, isCreateMode])

    useEffect(() => {
        if (open && isCreateMode && programs.length > 0) {
            const currentProgramId = form.getValues('program_template_id')
            if (!currentProgramId) {
                const defaultP = programs.find((p: any) => p.name.toUpperCase().includes('LİPÖDEM') || p.name.toUpperCase().includes('LIPODEM'))
                if (defaultP) {
                    form.setValue('program_template_id', defaultP.id)
                }
            }
        }
    }, [programs, open, isCreateMode, form])

    async function loadPatientData() {
        setLoading(true)
        console.log("Loading patient data for", patientId)
        const { data, error } = await supabase
            .from("patients")
            .select("full_name, birth_date, height, weight, gender, activity_level, liked_foods, disliked_foods, phone, patient_goals, program_template_id, visibility_settings, macro_target_mode, preferences, auto_plan_limit_count, auto_plan_limit_period_hours, ai_analysis_limit_count, ai_analysis_limit_period_hours, ai_photo_limit_count, ai_photo_limit_period_hours, ai_search_limit_count, ai_search_limit_period_hours")
            .eq("id", patientId)
            .single()

        // Load assigned diseases
        const { data: pDiseases } = await supabase
            .from('patient_diseases')
            .select('disease_id')
            .eq('patient_id', patientId)

        if (pDiseases) {
            setSelectedDiseaseIds(pDiseases.map(pd => pd.disease_id))
        }

        // Load assigned medications
        const { data: pMedications } = await supabase
            .from('patient_medications')
            .select('medication_id')
            .eq('patient_id', patientId)
            .is('ended_at', null) // Only active medications

        if (pMedications) {
            setSelectedMedicationIds(pMedications.filter(pm => pm.medication_id).map(pm => pm.medication_id))
        }

        if (data) {
            console.log("Patient data loaded:", data)
            console.log("=== DB'den Gelen Görünürlük Ayarı ===", data.visibility_settings)

            // Calculate age from birth_date
            let calculatedAge = 0
            if (data.birth_date) {
                const birth = new Date(data.birth_date)
                const today = new Date()
                calculatedAge = today.getFullYear() - birth.getFullYear()
            }

            form.reset({
                full_name: data.full_name || "",
                age: calculatedAge || 0,
                height: data.height || 0,
                weight: data.weight || 0,
                gender: data.gender || "male",
                activity_level: data.activity_level || 3,
                liked_foods: data.liked_foods ? data.liked_foods.join(", ") : "",
                disliked_foods: data.disliked_foods ? data.disliked_foods.join(", ") : "",
                phone: data.phone || "",
                patient_goals: data.patient_goals || [],
                program_template_id: data.program_template_id || null,
                max_future_weeks: data.visibility_settings?.max_future_weeks ?? 2,
                max_past_weeks: data.visibility_settings?.max_past_weeks ?? 2,
                allow_past: data.visibility_settings?.allow_past ?? false,
                allow_future: data.visibility_settings?.allow_future ?? false,
                show_flavor_tune: data.visibility_settings?.show_flavor_tune ?? false,
                macro_target_mode: data.macro_target_mode || "calculated",
                allow_program_selection: data.preferences?.allow_program_selection ?? null,
                allow_goal_selection: data.preferences?.allow_goal_selection ?? null,
                allow_week_delete: data.preferences?.allow_week_delete ?? null,
                auto_plan_limit_count: data.auto_plan_limit_count ?? null,
                auto_plan_limit_period_hours: data.auto_plan_limit_period_hours ?? null,
                ai_analysis_limit_count: data.ai_analysis_limit_count ?? null,
                ai_analysis_limit_period_hours: data.ai_analysis_limit_period_hours ?? null,
                ai_photo_limit_count: data.ai_photo_limit_count ?? null,
                ai_photo_limit_period_hours: data.ai_photo_limit_period_hours ?? null,
                ai_search_limit_count: data.ai_search_limit_count ?? null,
                ai_search_limit_period_hours: data.ai_search_limit_period_hours ?? null,
            })
            if (data.patient_goals) {
                // Pre-populate the selectedGoals array for the UI
                setSelectedGoals(data.patient_goals.map((g: string) => ({ id: g, name: g })))
            } else {
                setSelectedGoals([])
            }
        }
        setLoading(false)
    }

    async function onSubmit(values: z.infer<typeof profileSchema>) {
        setLoading(true)
        setError(null)
        console.log("=== Profil Kaydediliyor ===", "TİK DURUMU:", values.show_flavor_tune, "TÜM DEĞERLER:", values)

        // Calculate birth_date from age
        let birthDateStr = null
        if (values.age && values.age > 0) {
            const today = new Date()
            const birthYear = today.getFullYear() - values.age
            const d = new Date(birthYear, 0, 1)
            const year = d.getFullYear()
            const month = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            birthDateStr = `${year}-${month}-${day}`
        }

        // Convert comma/newline separated strings to arrays
        const likedArray = values.liked_foods
            ? values.liked_foods.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
            : []
        const dislikedArray = values.disliked_foods
            ? values.disliked_foods.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
            : []

        let currentPatientId = patientId

        // CREATE MODE: First create the patient with auth
        if (isCreateMode) {
            if (!values.email || !values.password) {
                setError("E-posta ve şifre zorunludur.")
                setLoading(false)
                return
            }

            const formData = new FormData()
            formData.append('fullName', values.full_name)
            formData.append('email', values.email)
            formData.append('password', values.password)

            const result = await createPatientWithAuth(formData)

            if (result.error) {
                setError(result.error)
                setLoading(false)
                return
            }

            currentPatientId = result.userId
        }

        // UPDATE: Update patient profile with all the details
        // First get existing preferences to merge
        const { data: existingPatient } = await supabase.from('patients').select('preferences').eq('id', currentPatientId).single()
        const existingPrefs = existingPatient?.preferences || {}

        const newPrefs = { ...existingPrefs }

        if (values.allow_program_selection !== null) {
            newPrefs.allow_program_selection = values.allow_program_selection
        } else {
            delete newPrefs.allow_program_selection // Remove specific override if set to use global
        }

        if (values.allow_goal_selection !== null) {
            newPrefs.allow_goal_selection = values.allow_goal_selection
        } else {
            delete newPrefs.allow_goal_selection
        }

        if (values.allow_week_delete !== null) {
            newPrefs.allow_week_delete = values.allow_week_delete
        } else {
            delete newPrefs.allow_week_delete
        }

        const { data: updatedRows, error: updateError } = await supabase
            .from("patients")
            .update({
                full_name: values.full_name,
                birth_date: birthDateStr,
                height: values.height,
                gender: values.gender,
                program_template_id: (values.program_template_id === 'none' || !values.program_template_id) ? null : values.program_template_id,
                liked_foods: likedArray,
                disliked_foods: dislikedArray,
                phone: values.phone || null,
                patient_goals: selectedGoals.map(g => g.name),
                macro_target_mode: values.macro_target_mode,
                visibility_settings: {
                    max_future_weeks: values.max_future_weeks,
                    max_past_weeks: values.max_past_weeks,
                    allow_past: values.allow_past,
                    allow_future: values.allow_future,
                    show_flavor_tune: values.show_flavor_tune
                },
                preferences: newPrefs,
                auto_plan_limit_count: values.auto_plan_limit_count || null,
                auto_plan_limit_period_hours: values.auto_plan_limit_period_hours || null,
                ai_analysis_limit_count: values.ai_analysis_limit_count || null,
                ai_analysis_limit_period_hours: values.ai_analysis_limit_period_hours || null,
                ai_photo_limit_count: values.ai_photo_limit_count || null,
                ai_photo_limit_period_hours: values.ai_photo_limit_period_hours || null,
                ai_search_limit_count: values.ai_search_limit_count || null,
                ai_search_limit_period_hours: values.ai_search_limit_period_hours || null
            })
            .eq("id", currentPatientId)
            .select("id")

        if (updateError) {
            console.error("UPDATE ERROR:", updateError)
        } else {
            console.log("=== Güncellenen Satır Sayısı ===", updatedRows?.length)
            const { data: checkData } = await supabase.from("patients").select("visibility_settings").eq("id", currentPatientId).single()
            console.log("=== Kayıt Sonrası DB Kontrolü ===", checkData?.visibility_settings)
        }

        // SYNC WEIGHT AND ACTIVITY
        if (!updateError && currentPatientId && values.weight && values.activity_level) {
            const { syncPatientWeightAndActivity } = await import('@/utils/measurement-sync')
            const result = await syncPatientWeightAndActivity(
                supabase,
                currentPatientId,
                values.weight,
                values.activity_level,
                activeWeekId
            )
            if (!result.success) {
                console.warn("Partial sync failure in profile dialog:", result.errors)
            }
        }

        // Save Diseases
        if (!updateError && currentPatientId) {
            // Delete existing
            await supabase.from('patient_diseases').delete().eq('patient_id', currentPatientId)

            // Insert new
            if (selectedDiseaseIds.length > 0) {
                const { error: diseaseError } = await supabase
                    .from('patient_diseases')
                    .insert(selectedDiseaseIds.map(dId => ({
                        patient_id: currentPatientId,
                        disease_id: dId
                    })))

                if (diseaseError) console.error("Error saving diseases:", diseaseError)
            }
        }

        // Save Medications
        if (!updateError && currentPatientId) {
            // Mark existing as ended (soft delete)
            await supabase
                .from('patient_medications')
                .update({ ended_at: new Date().toISOString().split('T')[0] })
                .eq('patient_id', currentPatientId)
                .is('ended_at', null)

            // Insert new active medications
            if (selectedMedicationIds.length > 0) {
                const newMeds = await supabase.from('medications').select('id, name').in('id', selectedMedicationIds)

                if (newMeds.data) {
                    const { error: medError } = await supabase
                        .from('patient_medications')
                        .insert(newMeds.data.map(med => ({
                            patient_id: currentPatientId,
                            medication_id: med.id,
                            medication_name: med.name,
                            started_at: new Date().toISOString().split('T')[0]
                        })))

                    if (medError) console.error("Error saving medications:", medError)
                }
            }
        }

        setLoading(false)

        if (updateError) {
            alert("Profil güncellenemedi: " + updateError.message)
        } else {
            // Retroactive Update Logic: Check if program changed
            const oldProgramId = form.formState.defaultValues?.program_template_id
            const newProgramId = values.program_template_id

            if (newProgramId && newProgramId !== 'none' && newProgramId !== oldProgramId) {
                if (window.confirm("Seçilen programın diyet türlerini mevcut haftalarınıza da uygulamak ister misiniz?\n\n(Bu işlem, manuel değiştirdiğiniz diyet türlerini programın varsayılanlarıyla üzerine yazacaktır.)")) {
                    try {
                        const selectedProgram = programs.find(p => p.id === newProgramId)

                        if (!selectedProgram) {
                            alert("HATA: Program verisi bulunamadı. Lütfen sayfayı yenileyin.")
                        } else {
                            // 1. Get Active Plan
                            const { data: activePlan, error: planError } = await supabase
                                .from('diet_plans')
                                .select('id')
                                .eq('patient_id', patientId)
                                .eq('status', 'active')
                                .maybeSingle()

                            if (planError || !activePlan) {
                                console.warn("No active diet plan found for patient - skipping retroactive update")
                                // Don't block the save, just skip the retroactive update
                            } else {

                                // 2. Get Weeks
                                const { data: existingWeeks, error: fetchError } = await supabase
                                    .from('diet_weeks')
                                    .select('id, week_number')
                                    .eq('diet_plan_id', activePlan.id)

                                if (fetchError) {
                                    console.error("Weeks fetch error:", fetchError)
                                    alert("HATA: Haftalar çekilirken hata: " + fetchError.message)
                                    return
                                }

                                if (existingWeeks && existingWeeks.length > 0) {
                                    let updatedCount = 0
                                    let matchedRules = 0
                                    const rules = selectedProgram.program_template_weeks || []

                                    if (rules.length > 0) {
                                        for (const week of existingWeeks) {
                                            const wNum = Number(week.week_number)
                                            const rule = rules.find((w: any) =>
                                                wNum >= Number(w.week_start) && wNum <= Number(w.week_end)
                                            )

                                            if (rule?.diet_type_id) {
                                                matchedRules++
                                                await supabase
                                                    .from('diet_weeks')
                                                    .update({ assigned_diet_type_id: rule.diet_type_id })
                                                    .eq('id', week.id)
                                                updatedCount++
                                            }
                                        }
                                        alert(`Program Uygulama Raporu:\nTopl. Hafta: ${existingWeeks.length}\nKurala Uyan Hafta: ${matchedRules}\nVeritabanı Güncellenen: ${updatedCount}`)
                                    } else {
                                        // FALLBACK: Program has no rules, assign global fallback to wipe out old program phases
                                        const { data: fallbackType } = await supabase
                                            .from('diet_types')
                                            .select('id')
                                            .is('patient_id', null)
                                            .limit(1)
                                            .maybeSingle()

                                        if (fallbackType) {
                                            for (const week of existingWeeks) {
                                                await supabase
                                                    .from('diet_weeks')
                                                    .update({ assigned_diet_type_id: fallbackType.id })
                                                    .eq('id', week.id)
                                                updatedCount++
                                            }
                                            alert(`Lütfen dikkat: Seçtiğiniz programda tanımlı hiçbir aşama (kural) bulunmadığı için mevcut '${existingWeeks.length}' diyet haftanız varsayılan protokole geçirilmiştir.`)
                                        } else {
                                            alert("UYARI: Seçilen programda tanımlı hafta kuralı (diyet türü) bulunmuyor ve varsayılan protokol atanamadı.")
                                        }
                                    }
                                }
                            }
                        }
                    } catch (updateError) {
                        console.error("Retroactive update failed:", updateError)
                    }
                }
            }

            onOpenChange(false)
            if (onSuccess) onSuccess(currentPatientId || undefined)
        }
        setLoading(false)
    }

    const toggleDisease = (id: string, checked: boolean) => {
        if (checked) {
            setSelectedDiseaseIds(prev => [...prev, id])
        } else {
            setSelectedDiseaseIds(prev => prev.filter(pId => pId !== id))
        }
    }

    const toggleMedication = (id: string, checked: boolean) => {
        if (checked) {
            setSelectedMedicationIds(prev => [...prev, id])
        } else {
            setSelectedMedicationIds(prev => prev.filter(pId => pId !== id))
        }
    }

    // Add new medication to global database and select it
    const addNewMedication = async (name: string) => {
        if (!name.trim()) return
        setIsAddingMed(true)
        try {
            const { data, error } = await supabase
                .from('medications')
                .insert({ name: name.trim() })
                .select('id, name, generic_name')
                .single()

            if (error) {
                if (error.code === '23505') {
                    alert('Bu ilaç zaten mevcut!')
                } else {
                    throw error
                }
            } else if (data) {
                setMedications(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
                setSelectedMedicationIds(prev => [...prev, data.id])
                setMedSearchTerm('')
                setShowMedDropdown(false)
            }
        } catch (e: any) {
            alert('İlaç eklenemedi: ' + e.message)
        }
        setIsAddingMed(false)
    }

    // Select existing medication
    const selectMedication = (med: { id: string, name: string, generic_name: string | null }) => {
        if (!selectedMedicationIds.includes(med.id)) {
            setSelectedMedicationIds(prev => [...prev, med.id])
        }
        setMedSearchTerm('')
        setShowMedDropdown(false)
    }

    // Remove medication from selection
    const removeMedication = (id: string) => {
        setSelectedMedicationIds(prev => prev.filter(pId => pId !== id))
    }

    // Filtered medications for dropdown
    const filteredMedications = medications.filter(med =>
        med.name.toLowerCase().includes(medSearchTerm.toLowerCase()) ||
        (med.generic_name && med.generic_name.toLowerCase().includes(medSearchTerm.toLowerCase()))
    ).filter(med => !selectedMedicationIds.includes(med.id))

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DraggableDialogContent className="sm:max-w-[700px] bg-card text-card-foreground max-h-[95vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isCreateMode ? 'Yeni Hasta Kaydı' : 'Hasta Profilini Düzenle'}</DialogTitle>
                    <DialogDescription className="sr-only">
                        {isCreateMode ? 'Yeni bir hasta profili oluşturun.' : 'Hastanın kişisel bilgilerini ve ayarlarını güncelleyin.'}
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-200">
                        {error}
                    </div>
                )}

                <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
                    <TabsList className="grid w-full grid-cols-5 mb-4">
                        <TabsTrigger value="profile">👤 Profil</TabsTrigger>
                        <TabsTrigger value="labs" disabled={isCreateMode}>🩸 Tahliller</TabsTrigger>
                        <TabsTrigger value="imaging" disabled={isCreateMode}>📷 Görüntüleme</TabsTrigger>
                        <TabsTrigger value="observations" disabled={isCreateMode}>📋 Seyir</TabsTrigger>
                        <TabsTrigger value="logs" disabled={isCreateMode}>📜 Loglar</TabsTrigger>
                    </TabsList>

                    <TabsContent value="profile">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                                {/* Auth Fields - Only shown in create mode */}
                                {isCreateMode && (
                                    <div className="border-b pb-4 mb-4 space-y-3">
                                        <h4 className="font-medium text-sm text-gray-700">🔐 Giriş Bilgileri</h4>
                                        <FormField
                                            control={form.control}
                                            name="email"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>E-posta *</FormLabel>
                                                    <FormControl>
                                                        <Input type="email" placeholder="hasta@email.com" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Şifre * (min 6 karakter)</FormLabel>
                                                    <FormControl>
                                                        <Input type="password" placeholder="••••••" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}

                                <FormField
                                    control={form.control}
                                    name="full_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Ad Soyad {isCreateMode && "*"}</FormLabel>
                                            <FormControl>
                                                <Input {...field} disabled={!isCreateMode && isDietitian} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="phone"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex items-center gap-1">
                                                <Phone className="w-4 h-4 text-gray-500" /> Telefon Numarası
                                            </FormLabel>
                                            <FormControl>
                                                <Input type="tel" placeholder="05XX XXX XX XX" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Diseases & Conditions Section */}
                                <div className="border bg-red-50/50 p-4 rounded-md space-y-3">
                                    <h4 className="font-medium text-sm text-gray-800 flex items-center gap-2">
                                        <Target className="w-4 h-4 text-blue-500" /> Hastanın Hedefleri
                                    </h4>
                                    <div className="space-y-2">
                                        <MultiSelectCreatable
                                            options={GOAL_OPTIONS}
                                            selected={selectedGoals}
                                            onChange={setSelectedGoals}
                                            placeholder="Hedef seçin veya yeni hedef ekleyin..."
                                            emptyText="Bulunamadı."
                                            createText="olarak hedeflerime ekle"
                                        />
                                    </div>

                                    <div className="h-px bg-red-100 my-4" />

                                    <h4 className="font-medium text-sm text-gray-800 flex items-center gap-2">
                                        🩺 Hastalıklar & Koşullar
                                        <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-normal">Yeni</span>
                                    </h4>
                                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                                        {diseases.length === 0 && <span className="text-xs text-gray-400 italic col-span-2">Tanımlı hastalık bulunamadı.</span>}
                                        {diseases.map(disease => (
                                            <div key={disease.id} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`d-${disease.id}`}
                                                    checked={selectedDiseaseIds.includes(disease.id)}
                                                    onCheckedChange={(c) => toggleDisease(disease.id, c as boolean)}
                                                />
                                                <label
                                                    htmlFor={`d-${disease.id}`}
                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                                >
                                                    {disease.name}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                {/* Medications Section - Smart Search */}
                                <div className="border bg-blue-50/50 p-4 rounded-md space-y-3">
                                    <h4 className="font-medium text-sm text-gray-800 flex items-center gap-2">
                                        💊 Kullandığı İlaçlar
                                    </h4>

                                    {/* Search Input */}
                                    <div className="relative">
                                        <Input
                                            placeholder="İlaç ara veya yeni ekle..."
                                            value={medSearchTerm}
                                            onChange={(e) => {
                                                setMedSearchTerm(e.target.value)
                                                setShowMedDropdown(true)
                                            }}
                                            onFocus={() => setShowMedDropdown(true)}
                                            onBlur={() => setTimeout(() => setShowMedDropdown(false), 200)}
                                            className="bg-white"
                                        />

                                        {/* Dropdown */}
                                        {showMedDropdown && medSearchTerm.length > 0 && (
                                            <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                                                {filteredMedications.slice(0, 10).map(med => (
                                                    <div
                                                        key={med.id}
                                                        className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm"
                                                        onMouseDown={() => selectMedication(med)}
                                                    >
                                                        {med.name}
                                                        {med.generic_name && <span className="text-gray-400 ml-1">({med.generic_name})</span>}
                                                    </div>
                                                ))}

                                                {/* Add New Option */}
                                                {medSearchTerm.trim() && !medications.some(m => m.name.toLowerCase() === medSearchTerm.toLowerCase()) && (
                                                    <div
                                                        className="px-3 py-2 hover:bg-green-50 cursor-pointer text-sm border-t bg-green-50/50 text-green-700 font-medium"
                                                        onMouseDown={() => addNewMedication(medSearchTerm)}
                                                    >
                                                        {isAddingMed ? '⏳ Ekleniyor...' : `➕ "${medSearchTerm}" yeni ilaç olarak ekle`}
                                                    </div>
                                                )}

                                                {filteredMedications.length === 0 && !medSearchTerm.trim() && (
                                                    <div className="px-3 py-2 text-gray-400 text-sm italic">Arama için yazmaya başlayın...</div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Selected Medications as Badges */}
                                    <div className="flex flex-wrap gap-2">
                                        {selectedMedicationIds.length === 0 && (
                                            <span className="text-xs text-gray-400 italic">Seçili ilaç yok</span>
                                        )}
                                        {selectedMedicationIds.map(medId => {
                                            const med = medications.find(m => m.id === medId)
                                            if (!med) return null
                                            return (
                                                <span
                                                    key={med.id}
                                                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs"
                                                >
                                                    {med.name}
                                                    <button
                                                        type="button"
                                                        onClick={() => removeMedication(med.id)}
                                                        className="hover:text-red-600 ml-1"
                                                    >
                                                        ✕
                                                    </button>
                                                </span>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Program Selection */}
                                <FormField
                                    control={form.control}
                                    name="program_template_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Beslenme Programı</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                value={field.value || "none"}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Program Seçiniz (Opsiyonel)" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="none">-- Program Yok --</SelectItem>
                                                    {programs.map(p => (
                                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="age"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Yaş</FormLabel>
                                                <FormControl>
                                                    <Input type="number" {...field} value={field.value as number ?? ''} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="gender"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Cinsiyet</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Seçiniz" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="male">Erkek</SelectItem>
                                                        <SelectItem value="female">Kadın</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="grid grid-cols-3 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="height"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Boy (cm)</FormLabel>
                                                <FormControl>
                                                    <Input type="number" {...field} value={field.value as number ?? ''} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="weight"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Kilo (kg)</FormLabel>
                                                <FormControl>
                                                    <Input type="number" {...field} value={field.value as number ?? ''} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="activity_level"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Aktivite (1-5)</FormLabel>
                                                <Select onValueChange={(val) => field.onChange(val)} defaultValue={String(field.value)} value={String(field.value)}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Seçiniz" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="1">1 - Hareketsiz</SelectItem>
                                                        <SelectItem value="2">2 - Az Hareketli</SelectItem>
                                                        <SelectItem value="3">3 - Orta Hareketli</SelectItem>
                                                        <SelectItem value="4">4 - Çok Hareketli</SelectItem>
                                                        <SelectItem value="5">5 - Sporcu</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="liked_foods"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Sevdiği Yemekler (Virgülle ayırın)</FormLabel>
                                            <FormControl>
                                                <Textarea placeholder="Örn: Ispanak, Tavuk ızgara..." className="resize-none" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="disliked_foods"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Sevmediği Yemekler (Virgülle ayırın)</FormLabel>
                                            <FormControl>
                                                <Textarea placeholder="Örn: Pırasa, Bamya..." className="resize-none" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="border-t pt-4 mt-4">
                                    <h3 className="text-sm font-medium mb-3">Portal Görünürlük Ayarları</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Past Weeks */}
                                        <div className="space-y-2 border rounded-md p-3">
                                            <FormField
                                                control={form.control}
                                                name="allow_past"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                                        <FormControl>
                                                            <Checkbox
                                                                checked={field.value}
                                                                onCheckedChange={field.onChange}
                                                            />
                                                        </FormControl>
                                                        <div className="leading-none">
                                                            <FormLabel className="text-xs">Tüm Geçmişi Göster</FormLabel>
                                                        </div>
                                                    </FormItem>
                                                )}
                                            />
                                            {!form.watch('allow_past') && (
                                                <FormField
                                                    control={form.control}
                                                    name="max_past_weeks"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-xs">Geçmiş Hafta Sayısı</FormLabel>
                                                            <FormControl>
                                                                <Input type="number" min="0" max="52" {...field} value={field.value as number ?? 2} />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                            <p className="text-[10px] text-muted-foreground">
                                                {form.watch('allow_past') ? 'Tüm geçmiş haftalar görünür.' : `Son ${form.watch('max_past_weeks') || 2} geçmiş hafta görünür.`}
                                            </p>
                                        </div>

                                        {/* Future Weeks */}
                                        <div className="space-y-2 border rounded-md p-3">
                                            <FormField
                                                control={form.control}
                                                name="allow_future"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                                        <FormControl>
                                                            <Checkbox
                                                                checked={field.value}
                                                                onCheckedChange={field.onChange}
                                                            />
                                                        </FormControl>
                                                        <div className="leading-none">
                                                            <FormLabel className="text-xs">Tüm Geleceği Göster</FormLabel>
                                                        </div>
                                                    </FormItem>
                                                )}
                                            />
                                            {!form.watch('allow_future') && (
                                                <FormField
                                                    control={form.control}
                                                    name="max_future_weeks"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-xs">Gelecek Hafta Sayısı</FormLabel>
                                                            <FormControl>
                                                                <Input type="number" min="0" max="52" {...field} value={field.value as number ?? 2} />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                            <p className="text-[10px] text-muted-foreground">
                                                {form.watch('allow_future') ? 'Tüm gelecek haftalar görünür.' : `İleri ${form.watch('max_future_weeks') || 2} gelecek hafta görünür.`}
                                            </p>
                                        </div>
                                        </div>

                                        {/* Show Flavor Tune Feature */}
                                        <div className="space-y-2 border rounded-md p-3 col-span-2">
                                            <FormField
                                                control={form.control}
                                                name="show_flavor_tune"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                                        <FormControl>
                                                            <Checkbox
                                                                checked={field.value}
                                                                onCheckedChange={field.onChange}
                                                            />
                                                        </FormControl>
                                                        <div className="leading-none">
                                                            <FormLabel className="text-xs">Lezzet Ayarı (Dengele) Özelliği Hasta Taraflı Açılsın</FormLabel>
                                                        </div>
                                                    </FormItem>
                                                )}
                                            />
                                            <p className="text-[10px] text-muted-foreground">
                                                Etkinleştirildiğinde hasta, listesinde belirlenen sınırları geçmeden yapay zeka destekli haftalık dengeleme simülasyonu çalıştırabilir. Öğelerin kendi menülerinden değiştirilmesine ek olarak toplu ve anlık iyileştirme sağlar.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 mt-4">
                                        <FormField
                                            control={form.control}
                                            name="macro_target_mode"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Dashboard Hedef Tipi</FormLabel>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Seçiniz" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="calculated">Otomatik Hesaplanan (Hesaplanan Makrolar)</SelectItem>
                                                            <SelectItem value="plan">Listeye Göre (Hazırlanan Liste Toplamı)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <DialogDescription className="text-[10px]">
                                                        Hastanın dashboard'undaki makro halkalarının (Calories, Protein vb.) neye göre dolacağını belirler.
                                                    </DialogDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <div className="border-t pt-4 mt-6">
                                        <h3 className="text-sm font-medium mb-3">Hesap Yetkilendirme Ayarları</h3>
                                        <div className="space-y-4 border rounded-md p-4 bg-gray-50/50">
                                            <FormField
                                                control={form.control}
                                                name="allow_program_selection"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm bg-white">
                                                        <div className="space-y-0.5">
                                                            <FormLabel>Program Seçme Yetkisi</FormLabel>
                                                            <p className="text-[10px] text-muted-foreground">
                                                                Şu anki varsayılan: {globalSettings.allow_program_selection ? 'Açık' : 'Kapalı'}
                                                            </p>
                                                        </div>
                                                        <FormControl>
                                                            <Select
                                                                onValueChange={(val) => field.onChange(val === "null" ? null : val === "true")}
                                                                value={field.value === null ? "null" : field.value ? "true" : "false"}
                                                            >
                                                                <SelectTrigger className="w-[140px] h-8 text-xs">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="null">Varsayılanı Kullan</SelectItem>
                                                                    <SelectItem value="true">Özel: İzin Ver</SelectItem>
                                                                    <SelectItem value="false">Özel: Kapat</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="allow_goal_selection"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm bg-white">
                                                        <div className="space-y-0.5">
                                                            <FormLabel>Hedef Seçme Yetkisi</FormLabel>
                                                            <p className="text-[10px] text-muted-foreground">
                                                                Şu anki varsayılan: {globalSettings.allow_goal_selection ? 'Açık' : 'Kapalı'}
                                                            </p>
                                                        </div>
                                                        <FormControl>
                                                            <Select
                                                                onValueChange={(val) => field.onChange(val === "null" ? null : val === "true")}
                                                                value={field.value === null ? "null" : field.value ? "true" : "false"}
                                                            >
                                                                <SelectTrigger className="w-[140px] h-8 text-xs">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="null">Varsayılanı Kullan</SelectItem>
                                                                    <SelectItem value="true">Özel: İzin Ver</SelectItem>
                                                                    <SelectItem value="false">Özel: Kapat</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="allow_week_delete"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm bg-white">
                                                        <div className="space-y-0.5">
                                                            <FormLabel>Hafta Silme Yetkisi</FormLabel>
                                                            <p className="text-[10px] text-muted-foreground">
                                                                Şu anki varsayılan: {globalSettings.allow_week_delete ? 'Açık' : 'Kapalı'}
                                                            </p>
                                                        </div>
                                                        <FormControl>
                                                            <Select
                                                                onValueChange={(val) => field.onChange(val === "null" ? null : val === "true")}
                                                                value={field.value === null ? "null" : field.value ? "true" : "false"}
                                                            >
                                                                <SelectTrigger className="w-[140px] h-8 text-xs">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="null">Varsayılanı Kullan</SelectItem>
                                                                    <SelectItem value="true">Özel: İzin Ver</SelectItem>
                                                                    <SelectItem value="false">Özel: Kapat</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>

                                    <div className="border-t pt-4 mt-6">
                                        <h3 className="text-sm font-medium mb-3">Otomatik Planlama Limitleri</h3>
                                        <div className="grid grid-cols-2 gap-4 border rounded-md p-4 bg-gray-50/50">
                                            <FormField
                                                control={form.control}
                                                name="auto_plan_limit_period_hours"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-0.5 rounded-lg border p-3 shadow-sm bg-white">
                                                        <FormLabel className="text-sm font-semibold">Periyot (Saat)</FormLabel>
                                                        <p className="text-[10px] text-muted-foreground mb-2">
                                                            Sınırsız için boş bırakın.
                                                        </p>
                                                        <FormControl>
                                                            <Input 
                                                                type="number" 
                                                                placeholder="Örn: 12" 
                                                                value={field.value || ""} 
                                                                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                                                                className="h-8 text-sm"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="auto_plan_limit_count"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-0.5 rounded-lg border p-3 shadow-sm bg-white">
                                                        <FormLabel className="text-sm font-semibold">Adet (Hak)</FormLabel>
                                                        <p className="text-[10px] text-muted-foreground mb-2">
                                                            Bu periyot içindeki deneme hakkı.
                                                        </p>
                                                        <FormControl>
                                                            <Input 
                                                                type="number" 
                                                                placeholder="Örn: 2" 
                                                                value={field.value || ""} 
                                                                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                                                                className="h-8 text-sm"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>

                                    <div className="border-t pt-4 mt-6">
                                        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                                            <ImageIcon className="h-4 w-4 text-orange-500" />
                                            Görsel Analiz Limitleri (Fotoğraf)
                                        </h3>
                                        <div className="grid grid-cols-2 gap-4 border rounded-md p-4 bg-orange-50/20 mb-6">
                                            <FormField
                                                control={form.control}
                                                name="ai_photo_limit_period_hours"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-0.5 rounded-lg border p-3 shadow-sm bg-white">
                                                        <FormLabel className="text-sm font-semibold text-orange-700">Periyot (Saat)</FormLabel>
                                                        <FormControl>
                                                            <Input 
                                                                type="number" 
                                                                placeholder="Örn: 24" 
                                                                value={field.value || ""} 
                                                                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                                                                className="h-8 text-sm"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="ai_photo_limit_count"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-0.5 rounded-lg border p-3 shadow-sm bg-white">
                                                        <FormLabel className="text-sm font-semibold text-orange-700">Adet (Hak)</FormLabel>
                                                        <FormControl>
                                                            <Input 
                                                                type="number" 
                                                                placeholder="Örn: 3" 
                                                                value={field.value || ""} 
                                                                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                                                                className="h-8 text-sm"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>

                                        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                                            <Search className="h-4 w-4 text-blue-500" />
                                            Akıllı Arama Limitleri (Metin)
                                        </h3>
                                        <div className="grid grid-cols-2 gap-4 border rounded-md p-4 bg-blue-50/20">
                                            <FormField
                                                control={form.control}
                                                name="ai_search_limit_period_hours"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-0.5 rounded-lg border p-3 shadow-sm bg-white">
                                                        <FormLabel className="text-sm font-semibold text-blue-700">Periyot (Saat)</FormLabel>
                                                        <FormControl>
                                                            <Input 
                                                                type="number" 
                                                                placeholder="Örn: 24" 
                                                                value={field.value || ""} 
                                                                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                                                                className="h-8 text-sm"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="ai_search_limit_count"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-0.5 rounded-lg border p-3 shadow-sm bg-white">
                                                        <FormLabel className="text-sm font-semibold text-blue-700">Adet (Hak)</FormLabel>
                                                        <FormControl>
                                                            <Input 
                                                                type="number" 
                                                                placeholder="Örn: 10" 
                                                                value={field.value || ""} 
                                                                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                                                                className="h-8 text-sm"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>

                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
                                    <Button type="submit" disabled={loading}>Kaydet</Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </TabsContent>

                    <TabsContent value="labs" className="space-y-6">
                        {patientId ? (
                            <LabResultsGrid patientId={patientId} />
                        ) : (
                            <div className="text-center py-8 text-gray-400 italic">
                                Tahlil sonuçlarını görmek için önce hastayı kaydedin.
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="imaging" className="space-y-6">
                        {patientId ? (
                            <PatientNotesEditor
                                patientId={patientId}
                                type="imaging"
                                title="Görüntüleme Tetkikleri"
                                icon={<Camera className="h-4 w-4 text-purple-600" />}
                                showTitle={true}
                            />
                        ) : (
                            <div className="text-center py-8 text-gray-400 italic">
                                Görüntüleme sonuçlarını görmek için önce hastayı kaydedin.
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="observations" className="space-y-6">
                        {patientId ? (
                            <PatientNotesEditor
                                patientId={patientId}
                                type="observations"
                                title="Seyir ve Gözlem Notları"
                                icon={<ClipboardList className="h-4 w-4 text-emerald-600" />}
                                showTitle={false}
                            />
                        ) : (
                            <div className="text-center py-8 text-gray-400 italic">
                                Seyir notlarını görmek için önce hastayı kaydedin.
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="logs" className="space-y-6">
                        {!patientId ? (
                            <div className="text-center py-8 text-gray-400 italic">
                                Logları görmek için önce hastayı kaydedin.
                            </div>
                        ) : isLoadingLogs ? (
                            <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
                        ) : activityLogs.length === 0 ? (
                            <div className="text-center py-8 text-gray-400 italic">
                                Henüz bu hasta için bir etkinlik kaydedilmemiş.
                            </div>
                        ) : (
                            <div className="border rounded-md overflow-hidden bg-white">
                                <Table>
                                    <TableHeader className="bg-gray-50/80">
                                        <TableRow>
                                            <TableHead className="w-[180px]">Tarih</TableHead>
                                            <TableHead>Eylem Türü</TableHead>
                                            <TableHead>Detaylar / IP</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {activityLogs.map((log) => {
                                            const actionLabels: Record<string, string> = {
                                                'login_success': 'Sisteme Giriş (Login)',
                                                'auto_plan_generated': 'Otomatik Plan Oluşturuldu'
                                            }
                                            const label = actionLabels[log.action_type] || log.action_type
                                            let details = '-'
                                            if (log.metadata) {
                                                if (log.metadata.ip_address) {
                                                    details = `IP: ${log.metadata.ip_address}`
                                                } else {
                                                    details = JSON.stringify(log.metadata)
                                                }
                                            }

                                            return (
                                                <TableRow key={log.id}>
                                                    <TableCell className="font-medium text-xs text-gray-500">
                                                        {new Date(log.created_at).toLocaleString("tr-TR")}
                                                    </TableCell>
                                                    <TableCell className="font-semibold text-sm">
                                                        {label}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-gray-500">
                                                        {details}
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

            </DraggableDialogContent>
        </Dialog>
    )
}

