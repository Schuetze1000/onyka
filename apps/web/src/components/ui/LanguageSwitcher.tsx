import { useTranslation } from 'react-i18next'
import { setLanguageWithServer, getCurrentLanguage, languages } from '@/i18n'

interface LanguageSwitcherProps {
  collapsed?: boolean
}

export function LanguageSwitcher({ collapsed = false }: LanguageSwitcherProps) {
  useTranslation()
  const currentLang = getCurrentLanguage()
  const nextLanguage = languages[(languages.findIndex((lang) => lang.code === currentLang) + 1) % languages.length]

  const toggleLanguage = () => {
    setLanguageWithServer(nextLanguage.code)
  }

  const label = nextLanguage.label

  return (
    <button
      onClick={toggleLanguage}
      className={`
        group relative flex items-center justify-center
        transition-all duration-200 ease-out
        ${collapsed
          ? 'p-2'
          : 'w-8 h-8 rounded-xl bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-elevated)]'
        }
      `}
      aria-label={label}
      title={label}
    >
      <div className={`relative ${collapsed ? 'w-5 h-5' : 'w-[18px] h-[18px]'} flex items-center justify-center`}>
        {languages.map((lang) => (
          <span
            key={lang.code}
            className={`
              absolute inset-0 flex items-center justify-center leading-none
              transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]
              ${collapsed ? 'text-[17px]' : 'text-[15px]'}
              ${currentLang === lang.code
                ? 'opacity-100 rotate-0 scale-100'
                : 'opacity-0 -rotate-180 scale-50'
              }
            `}
            aria-hidden="true"
          >{lang.flag}</span>
        ))}
      </div>
    </button>
  )
}
