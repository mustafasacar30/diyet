'use client';

import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, Database, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import Link from 'next/link';

interface TableCounts {
  [key: string]: number;
}

export default function BackupDashboard() {
  const [counts, setCounts] = useState<TableCounts>({});
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/backup');
      const data = await res.json();
      if (data.success) {
        setCounts(data.counts);
      } else {
        setError(data.error || 'Veriler alınamadı.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCounts();
  }, []);

  const totalTables = Object.keys(counts).filter(k => counts[k] >= 0).length;
  const errorTables = Object.keys(counts).filter(k => counts[k] < 0).length;

  const handleDownloadBackup = async () => {
    setIsExporting(true);
    try {
      const res = await fetch('/api/backup', {
        method: 'POST',
      });
      const data = await res.json();
      
      if (data.success) {
        const jsonString = JSON.stringify(data.data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `diyet_yedek_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert('Yedekleme alınırken hata oluştu: ' + data.error);
      }
    } catch (err: any) {
      alert('İndirme başarısız: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* HEADER SECTION */}
      <div className="bg-[#1a233a] rounded-2xl p-8 flex flex-col md:flex-row items-start md:items-center justify-between text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full blur-3xl opacity-20 -mr-10 -mt-10 pointer-events-none"></div>
        <div className="z-10 flex items-center gap-4">
          <div className="bg-emerald-500/20 p-3 rounded-xl border border-emerald-500/30">
            <Database className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold mb-1">Veritabanı Paket Yedekleme</h1>
            <p className="text-gray-300 text-sm">Supabase verilerinizi tek bir tıklamayla JSON paketi halinde güvenle yedekleyin</p>
          </div>
        </div>
        <button 
          onClick={fetchCounts}
          disabled={loading}
          className="mt-4 md:mt-0 z-10 flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl transition-all font-medium disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Yükleniyor...' : 'YENİLE'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: TABLES GRID */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-600 font-medium">
              <CheckCircle className="w-5 h-5" />
              Tümünü Seç / Bırak (Otomatik)
            </div>
            <div className="text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full text-sm font-bold border border-emerald-100">
              {totalTables} / {Object.keys(counts).length || 53} TABLO
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.keys(counts).sort().map(table => {
              const count = counts[table];
              const isError = count < 0;
              return (
                <div key={table} className="bg-white rounded-xl p-4 shadow-sm border border-emerald-200 flex items-center justify-between hover:border-emerald-400 transition-colors cursor-default">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <CheckCircle className={`w-5 h-5 shrink-0 ${isError ? 'text-red-400' : 'text-emerald-500'}`} />
                    <div className="truncate">
                      <div className="font-bold text-gray-800 truncate" title={table}>{table.replace(/_/g, ' ').toUpperCase()}</div>
                      <div className="text-xs text-gray-400 font-mono tracking-wider truncate">{table}</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-gray-600 bg-gray-100 px-2 py-1 rounded shrink-0">
                    {isError ? 'HATA' : `${count} SATIR`}
                  </div>
                </div>
              );
            })}
            
            {loading && Object.keys(counts).length === 0 && (
              Array.from({length: 10}).map((_, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100 h-20 animate-pulse"></div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: ACTION CARDS */}
        <div className="space-y-6">
          
          {/* JSON BACKUP CARD */}
          <div className="bg-white rounded-2xl p-6 shadow-md border border-gray-100">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-6">
              <FileText className="w-5 h-5 text-emerald-500" />
              Yedek Paket Özeti
            </h2>
            
            <div className="space-y-4 mb-8">
              <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                <span className="text-sm text-gray-500 tracking-wider">DURUM</span>
                <span className="text-sm font-bold text-emerald-600">{loading ? 'HESAPLANIYOR' : 'HAZIR'}</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                <span className="text-sm text-gray-500 tracking-wider">SEÇİLEN TABLOLAR</span>
                <span className="text-sm font-bold text-gray-800">{totalTables} ADET</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                <span className="text-sm text-gray-500 tracking-wider">FORMAT</span>
                <span className="text-sm font-bold text-gray-800">.JSON</span>
              </div>
            </div>

            <button 
              onClick={handleDownloadBackup}
              disabled={loading || isExporting || totalTables === 0}
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/30"
            >
              {isExporting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              {isExporting ? 'DIŞA AKTARILIYOR...' : 'YEDEK PAKETİNİ İNDİR'}
            </button>
          </div>

          {/* SQL SCHEMA CARD */}
          <div className="bg-[#1a233a] rounded-2xl p-6 shadow-md text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>
            <h2 className="flex items-center gap-2 text-lg font-bold mb-4 relative z-10">
              <Database className="w-5 h-5 text-blue-400" />
              Veritabanı Şeması (SQL)
            </h2>
            <p className="text-sm text-gray-300 mb-6 relative z-10 leading-relaxed">
              Supabase Dashboard'a girmeden, sitenizdeki tüm tabloların yapı taşlarını, ilişkilerini ve güvenlik kurallarını içeren tek bir SQL şablon dosyasını indirin.
            </p>
            <a 
              href="/Supabase_Schema.sql" 
              download="Supabase_Schema.sql"
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-indigo-600/30 relative z-10"
            >
              <Download className="w-5 h-5" />
              ŞEMA DOSYASINI İNDİR (SQL)
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}
