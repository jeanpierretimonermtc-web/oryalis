import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from './Input'
import { isoToDisplayDate, digitsToDisplayDate, digitsToIsoDate } from '@/shared/lib/dateFormat'

interface Props {
  label?: string
  value: string
  onChangeValue: (iso: string) => void
  placeholder?: string
}

export function DateInput({ label, value, onChangeValue, placeholder }: Props) {
  const { i18n } = useTranslation()
  const isFr = i18n.language.startsWith('fr')
  const [text, setText] = useState(isFr ? isoToDisplayDate(value) : value)

  useEffect(() => {
    setText(isFr ? isoToDisplayDate(value) : value)
  }, [value, isFr])

  if (!isFr) {
    return <Input label={label} value={text} onChangeText={onChangeValue} placeholder={placeholder ?? 'YYYY-MM-DD'} />
  }

  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    setText(digitsToDisplayDate(digits))
    onChangeValue(digitsToIsoDate(digits))
  }

  return (
    <Input
      label={label}
      value={text}
      onChangeText={handleChange}
      placeholder={placeholder ?? 'JJ/MM/AAAA'}
      keyboardType="number-pad"
      maxLength={10}
    />
  )
}
