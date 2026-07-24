import { useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Switch } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import {
  AUTOMATION_RULES, TRIGGER_LABELS, TRIGGER_ICONS, TRIGGER_MODULE,
  renderRuleTitle, renderRuleDescription,
} from '@/features/automations/automationService'
import type { AutoTrigger, AutomationRule } from '@/features/automations/automationService'
import type { ModuleKey } from '@/shared/lib/types'
import { AdvisorGate } from '@/features/subscriptions/AdvisorGate'

const TRIGGERS: AutoTrigger[] = ['new_client', 'order', 'appointment', 'no_contact']

const ACTION_ICONS: Record<string, string> = {
  whatsapp: '💬',
  call:     '📞',
  email:    '✉️',
  sms:      '📱',
  rdv:      '📅',
}

function RuleRow({
  rule, delayDays, onChangeDelay, colors, styles,
}: {
  rule: AutomationRule
  delayDays: number
  onChangeDelay: (days: number) => void
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(String(delayDays))

  function commit() {
    const parsed = parseInt(draft, 10)
    if (!isNaN(parsed) && parsed >= 0 && parsed !== delayDays) onChangeDelay(parsed)
    else setDraft(String(delayDays))
    setEditing(false)
  }

  return (
    <View style={styles.ruleRow}>
      {editing ? (
        <View style={[styles.delayBadge, styles.delayBadgeEditing, { borderColor: colors.primary }]}>
          <Text style={[styles.delayText, { color: colors.primary }]}>J+</Text>
          <TextInput
            style={[styles.delayInput, { color: colors.primary }]}
            value={draft}
            onChangeText={setDraft}
            keyboardType="number-pad"
            autoFocus
            onBlur={commit}
            onSubmitEditing={commit}
            selectTextOnFocus
            maxLength={3}
          />
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.delayBadge, { backgroundColor: colors.primaryLight }]}
          onPress={() => { setDraft(String(delayDays)); setEditing(true) }}
          activeOpacity={0.7}
        >
          <Text style={[styles.delayText, { color: colors.primary }]}>
            {delayDays === 0 ? t('settings.automation_immediate') : `J+${delayDays}`}
          </Text>
        </TouchableOpacity>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.ruleTitle} numberOfLines={2}>{renderRuleTitle(rule, '[prénom]', delayDays)}</Text>
        <Text style={styles.ruleDesc}>{renderRuleDescription(rule, delayDays)}</Text>
      </View>
      <Text style={styles.actionIcon}>{ACTION_ICONS[rule.actionType] ?? '📋'}</Text>
    </View>
  )
}

function TriggerSection({
  trigger, rules, enabled, onToggle, getDelay, onChangeDelay, colors, styles,
}: {
  trigger:   AutoTrigger
  rules:     AutomationRule[]
  enabled:   boolean
  onToggle:  () => void
  getDelay:  (rule: AutomationRule) => number
  onChangeDelay: (rule: AutomationRule, days: number) => void
  colors:    ThemeColors
  styles:    ReturnType<typeof makeStyles>
}) {
  return (
    <View style={[styles.section, !enabled && styles.sectionDisabled]}>
      {/* Section header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEmoji}>{TRIGGER_ICONS[trigger]}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{TRIGGER_LABELS[trigger]}</Text>
          <Text style={styles.sectionSub}>{rules.length} relance{rules.length > 1 ? 's' : ''} automatique{rules.length > 1 ? 's' : ''}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ true: colors.primary }}
          thumbColor="#fff"
        />
      </View>

      {/* Rules */}
      {enabled && (
        <View style={styles.rulesList}>
          {rules.map((rule, i) => (
            <View key={rule.id}>
              {i > 0 && <View style={styles.ruleSep} />}
              <RuleRow
                rule={rule}
                delayDays={getDelay(rule)}
                onChangeDelay={(days) => onChangeDelay(rule, days)}
                colors={colors}
                styles={styles}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

export default function SettingsAutomationsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { isModuleActive, toggleModule, getAutomationDelay, setAutomationDelay } = useAppConfig()

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.section_automations'))} />
      <AdvisorGate feature={t('subscription.features.automations')}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Info banner */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoEmoji}>⚡</Text>
          <Text style={styles.infoText}>
            Les relances automatiques sont créées dans votre liste Relances dès qu'un événement se produit (nouveau client, commande, RDV terminé).{' '}
            {t('settings.automation_edit_hint')}
          </Text>
        </View>

        {TRIGGERS.map(trigger => {
          const rules   = AUTOMATION_RULES.filter(r => r.trigger === trigger)
          const modKey  = TRIGGER_MODULE[trigger] as ModuleKey
          const enabled = isModuleActive(modKey)
          return (
            <TriggerSection
              key={trigger}
              trigger={trigger}
              rules={rules}
              enabled={enabled}
              onToggle={() => toggleModule(modKey, !enabled)}
              getDelay={(rule) => getAutomationDelay(rule.id, rule.delayDays)}
              onChangeDelay={(rule, days) => setAutomationDelay(rule.id, days)}
              colors={colors}
              styles={styles}
            />
          )
        })}

        {/* Legend */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>{t('settings.automation_legend_title')}</Text>
          <View style={styles.legendRow}>
            <View style={styles.legendChip}><Text style={styles.legendChipText}>{'{prénom}'}</Text></View>
            <Text style={styles.legendDesc}>{t('settings.automation_legend_desc')}</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      </AdvisorGate>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content:   { padding: 16, gap: 14, maxWidth: 720, alignSelf: 'center', width: '100%' },

  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: 14,
    padding: 14,
  },
  infoEmoji: { fontSize: 20 },
  infoText:  { flex: 1, fontSize: 13, fontFamily: fonts.body, color: colors.primary, lineHeight: 19 },

  section: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0, 0, 0, 0.04)' }],
    elevation: 2,
  },
  sectionDisabled: { opacity: 0.6 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: 0,
  },
  sectionEmoji: { fontSize: 24 },
  sectionTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  sectionSub:   { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 1 },

  rulesList: { borderTopWidth: 1, borderTopColor: colors.border },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  ruleSep:    { height: 1, backgroundColor: colors.border, marginHorizontal: 16 },
  delayBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start', flexShrink: 0, minWidth: 52, alignItems: 'center' },
  delayBadgeEditing: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, backgroundColor: 'transparent' },
  delayText:  { fontSize: 11, fontFamily: fonts.bold },
  delayInput: { fontSize: 11, fontFamily: fonts.bold, padding: 0, minWidth: 20 },
  ruleTitle:  { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, lineHeight: 18 },
  ruleDesc:   { fontSize: 11, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 1 },
  actionIcon: { fontSize: 18, flexShrink: 0, marginTop: 2 },

  legend: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  legendTitle: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  legendRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendChip:  { backgroundColor: colors.bgDim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  legendChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  legendDesc:  { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
  })
}
