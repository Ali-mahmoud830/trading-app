"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'
import type { Language } from '@/lib/i18n'

// ─── Static locale imports ────────────────────────────────────────────────────
// Imported statically so webpack can bundle them safely.
import enNav from '../locales/en/nav.json'
import enCommon from '../locales/en/common.json'
import enAuth from '../locales/en/auth.json'
import enDashboard from '../locales/en/dashboard.json'
import enTrading from '../locales/en/trading.json'
import enPackages from '../locales/en/packages.json'
import enReferrals from '../locales/en/referrals.json'
import enProfile from '../locales/en/profile.json'
import enWallet from '../locales/en/wallet.json'
import enAdmin from '../locales/en/admin.json'

import arNav from '../locales/ar/nav.json'
import arCommon from '../locales/ar/common.json'
import arAuth from '../locales/ar/auth.json'
import arDashboard from '../locales/ar/dashboard.json'
import arTrading from '../locales/ar/trading.json'
import arPackages from '../locales/ar/packages.json'
import arReferrals from '../locales/ar/referrals.json'
import arProfile from '../locales/ar/profile.json'
import arWallet from '../locales/ar/wallet.json'
import arAdmin from '../locales/ar/admin.json'

import frNav from '../locales/fr/nav.json'
import frCommon from '../locales/fr/common.json'
import frAuth from '../locales/fr/auth.json'
import frDashboard from '../locales/fr/dashboard.json'
import frTrading from '../locales/fr/trading.json'
import frPackages from '../locales/fr/packages.json'
import frReferrals from '../locales/fr/referrals.json'
import frProfile from '../locales/fr/profile.json'
import frWallet from '../locales/fr/wallet.json'
import frAdmin from '../locales/fr/admin.json'

import deNav from '../locales/de/nav.json'
import deCommon from '../locales/de/common.json'
import deAuth from '../locales/de/auth.json'
import deDashboard from '../locales/de/dashboard.json'
import deTrading from '../locales/de/trading.json'
import dePackages from '../locales/de/packages.json'
import deReferrals from '../locales/de/referrals.json'
import deProfile from '../locales/de/profile.json'
import deWallet from '../locales/de/wallet.json'
import deAdmin from '../locales/de/admin.json'

// Build a merged translation object per locale
const localeData: Record<string, Record<string, any>> = {
  en: { nav: enNav, common: enCommon, auth: enAuth, dashboard: enDashboard, trading: enTrading, packages: enPackages, referrals: enReferrals, profile: enProfile, wallet: enWallet, admin: enAdmin },
  ar: { nav: arNav, common: arCommon, auth: arAuth, dashboard: arDashboard, trading: arTrading, packages: arPackages, referrals: arReferrals, profile: arProfile, wallet: arWallet, admin: arAdmin },
  fr: { nav: frNav, common: frCommon, auth: frAuth, dashboard: frDashboard, trading: frTrading, packages: frPackages, referrals: frReferrals, profile: frProfile, wallet: frWallet, admin: frAdmin },
  de: { nav: deNav, common: deCommon, auth: deAuth, dashboard: deDashboard, trading: deTrading, packages: dePackages, referrals: deReferrals, profile: deProfile, wallet: deWallet, admin: deAdmin },
}

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
  isRTL: boolean
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('en')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const savedLanguage = localStorage.getItem('language') as Language
    if (savedLanguage && localeData[savedLanguage]) {
      setLanguage(savedLanguage)
    }
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem('language', language)
    document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr')
    document.documentElement.setAttribute('lang', language)
  }, [language, mounted])

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang)
  }

  // t() supports nested dot notation: e.g. t('profile.verifiedAccount')
  const t = (key: string): string => {
    const parts = key.split('.')
    // parts[0] is namespace, rest is nested path within that namespace
    const [ns, ...rest] = parts
    const data = localeData[language] ?? localeData['en']
    if (!data || !data[ns]) return key
    let current: any = data[ns]
    for (const k of rest) {
      if (current && typeof current === 'object' && k in current) {
        current = current[k]
      } else {
        // Fall back to English
        const enData = localeData['en']?.[ns]
        let fallback: any = enData
        for (const fk of rest) {
          if (fallback && typeof fallback === 'object' && fk in fallback) {
            fallback = fallback[fk]
          } else {
            return key
          }
        }
        return typeof fallback === 'string' ? fallback : key
      }
    }
    return typeof current === 'string' ? current : key
  }

  const value: LanguageContextType = {
    language,
    setLanguage: handleSetLanguage,
    t,
    isRTL: language === 'ar',
  }

  return (
    <LanguageContext.Provider value={value}>
      <div key={language} dir={language === 'ar' ? 'rtl' : 'ltr'}>
        {children}
      </div>
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
