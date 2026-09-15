import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function PrivacyPolicyPage() {
    return (
        <div className="container max-w-4xl py-10">
            <Card>
                <CardHeader>
                    <CardTitle className="text-3xl font-bold">Gizlilik Politikası</CardTitle>
                    <p className="text-muted-foreground mt-2">Son güncellenme tarihi: {new Date().toLocaleDateString('tr-TR')}</p>
                </CardHeader>
                <CardContent className="space-y-6 text-sm md:text-base leading-relaxed">
                    
                    <section>
                        <h2 className="text-xl font-semibold mb-3">1. Veri Toplama ve Kullanım</h2>
                        <p>
                            Diyet Uygulaması (bundan sonra "Uygulama" olarak anılacaktır), kullanıcılara diyet planlama, takip ve iletişim hizmetleri sunmak amacıyla belirli kişisel bilgileri toplayabilir. Bu bilgiler ad, soyad, e-posta adresi, kilo, boy, yaş, diyet hedefleri ve sağlıkla ilgili genel verileri (kullanıcının kendi rızasıyla paylaştığı) içerebilir.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold mb-3">2. Verilerin Saklanması ve Güvenliği</h2>
                        <p>
                            Toplanan kişisel veriler, yetkisiz erişim, kullanım veya ifşaya karşı korunmak için güvenli sunucularda saklanmaktadır. Kullanıcı şifreleri şifrelenmiş olarak tutulur ve üçüncü şahıslarla ticari amaçla paylaşılmaz.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold mb-3">3. Kullanıcı Hakları (Veri Silme)</h2>
                        <p>
                            Kullanıcılar, hesaplarını ve hesaplarıyla ilişkili tüm kişisel verileri diledikleri zaman silme hakkına sahiptir. Veri silme talebi, uygulama içi ayarlar menüsünden veya iletişim kanallarımız aracılığıyla iletilebilir. Talep üzerine veriler sistemlerimizden kalıcı olarak silinir.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold mb-3">4. Üçüncü Taraf Hizmetleri</h2>
                        <p>
                            Uygulama, hizmet kalitesini artırmak için analitik ve barındırma (hosting) sağlayıcıları gibi üçüncü taraf araçlar kullanabilir. Bu hizmetler, kendi gizlilik politikalarına tabi olarak çalışır.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold mb-3">5. Değişiklikler</h2>
                        <p>
                            Bu Gizlilik Politikası, zaman zaman güncellenebilir. Herhangi bir değişiklik yapıldığında, güncel sürüm uygulama içinde yayınlanacaktır.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold mb-3">6. İletişim</h2>
                        <p>
                            Gizlilik politikamızla ilgili herhangi bir sorunuz varsa, lütfen bizimle iletişime geçmekten çekinmeyin.
                        </p>
                    </section>

                </CardContent>
            </Card>
        </div>
    )
}
