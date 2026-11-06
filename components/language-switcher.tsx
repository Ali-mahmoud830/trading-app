"use client"

import * as React from "react"
import { Check, Globe } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLanguage } from "@/contexts/language-context"
import { Language } from "@/lib/i18n"

interface LanguageSwitcherProps {
    hideArabic?: boolean;
}

export function LanguageSwitcher({ hideArabic = false }: LanguageSwitcherProps = {}) {
    const { language, setLanguage } = useLanguage()

    const allLanguages: { code: Language; label: string }[] = [
        { code: "en", label: "English" },
        { code: "ar", label: "العربية" },
        { code: "fr", label: "Français" },
        { code: "de", label: "Deutsch" },
    ]

    const languages = hideArabic
        ? allLanguages.filter((l) => l.code !== "ar")
        : allLanguages

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="bg-transparent border-slate-600 text-slate-300 hover:text-white">
                    <Globe className="h-4 w-4 mr-2" />
                    <span className="uppercase">{language}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {languages.map((lang) => (
                    <DropdownMenuItem
                        key={lang.code}
                        onClick={() => setLanguage(lang.code)}
                        className="flex items-center justify-between"
                    >
                        <span>{lang.label}</span>
                        {language === lang.code && <Check className="h-4 w-4 ml-2" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
