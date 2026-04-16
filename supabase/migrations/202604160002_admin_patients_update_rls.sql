-- Adminlerin ve takım liderlerinin tüm hastaları güncelleyebilmesi için tam yetki RLS i
DROP POLICY IF EXISTS "Admins can update any patient" ON public.patients;
CREATE POLICY "Admins can update any patient" ON public.patients
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- Ek olarak belki Diyetisyene veya Doktora da izin gerekebilir ama asıl sorun Admin yetkisi
