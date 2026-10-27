import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Platform, useWindowDimensions } from 'react-native'
import { Stack, router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { useClientFollowups } from '@/features/followups/useFollowups'
import { useClient } from '@/features/clients/useClient'
import { createFollowup, updateFollowup, toggleFollowupDone, deleteFollowup } from '@/features/followups/followupService'
import { FollowupCompletionModal } from '@/features/followups/FollowupCompletionModal'
import { OpenActionLink } from '@/shared/components/ui/OpenActionLink'
import { CompleteToggle } from '@/shared/components/ui/CompleteToggle'
import { getInteractionsBySourceFollowupIds } from '@/features/interactions/interactionService'
import { setAppointmentTaskDone, deleteTask } from '@/features/appointments/appointmentService'
import { supabase } from '@/shared/lib/supabase'
import { Input } from '@/shared/components/ui/Input'
import { CalendarPickerModal } from '@/shared/components/ui/CalendarPickerModal'
import type { CalendarBusyAppointment } from '@/shared/components/ui/CalendarPickerModal'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { Card } from '@/shared/components/ui/Card'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { PIPELINE_STAGES } from '@/shared/lib/types'
import type { Followup, Interaction, NextActionType, PipelineStage } from '@/shared/lib/types'
import { formatDate } from '@/shared/lib/dateFormat'

const ACTION_TYPES: NextActionType[] = ['call', 'whatsapp', 'sms', 'email', 'rdv']
const ACTION_ICONS: Record<NextActionType, string> = {
  call: '📞', whatsapp: '💬', sms: '📱', email: '✉️', rdv: '📅',
}

// ── Concept unifié "action à suivre" ────────────────────────────────────────
// Regroupe relances, tâches liées à un RDV et interactions programmées dans
// une seule liste chronologique — un utilisateur ne devrait pas avoir à
// chercher dans 3 endroits différents "qu'est-ce qu'il me reste à faire".
type UnifiedAction = {
  id: string
  source: 'followup' | 'task' | 'interaction'
  title: string
  subtitle: string | null
  dueDate: string
  done: boolean
  actionType: NextActionType | null
  followup?: Followup
  // UI-AFFORDANCE-1.1 §3 — destination réelle d'une tâche RDV (appointment_tasks.appointment_id,
  // toujours renseignée : une tâche n'existe que rattachée à un RDV). Absent pour followup/
  // interaction.
  appointmentId?: string
}

// CONTACT-4.2 — même logique de jour calendaire que urgencyOf() dans
// clients/[id]/index.tsx (dupliquée localement, convention déjà en place dans ce fichier
// pour daysUntil/relativeDayLabel-like helpers) : sert uniquement à colorer la carte ciblée
// par ?focus=<id>, jamais une surbrillance générale de la liste (hors périmètre CONTACT-4.2).
type FocusUrgency = 'overdue' | 'today' | null
function focusUrgency(dateStr: string): FocusUrgency {
  const target = new Date(dateStr)
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86400000)
  return diff < 0 ? 'overdue' : diff === 0 ? 'today' : null
}

// FOLLOWUP-HISTORY-1 §5/§6/§7/§8/§9/§10 — synthèse compacte "résultat · extrait" à partir de
// l'interaction historique, jamais un nouveau champ recopié ailleurs. Résultat et compte-rendu
// sont tous deux facultatifs (§8/§9) ; si aucun des deux n'est renseigné, l'échange existe quand
// même et ne doit jamais être confondu avec une clôture simple (§10) — "Échange enregistré" seul.
function exchangeSummaryText(interaction: Interaction, t: (key: string) => string): string {
  const resultText = interaction.completion_result ? t(`interaction_outcomes.${interaction.completion_result}`) : null
  const notesText = interaction.notes_brutes?.trim() || null
  if (resultText && notesText) return `${resultText} · ${notesText}`
  if (resultText) return resultText
  if (notesText) return notesText
  return t('followups.exchange_recorded')
}

export default function ClientFollowupsScreen() {
  const { t, i18n } = useTranslation()
  // CONTACT-4.2 — focus = id exact de la ressource ciblée depuis "Autres actions" (fiche
  // Contact), jamais un titre/date/index. Optionnel : absent pour toute navigation normale
  // vers cette page (bouton "+", onglet Suivi, etc.), comportement alors inchangé.
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  // UI-CREATE-1 — desktop web : bouton explicite "+ Ajouter une relance" (page dans un
  // contexte contact, cf. convention finale) ; mobile : FAB rond inchangé (accessibilityLabel
  // explicite). Même convention que clients/[id]/interactions.tsx.
  const { width: screenW } = useWindowDimensions()
  const isDesktopWeb = Platform.OS === 'web' && screenW >= 768
  const { followups, loading, refresh } = useClientFollowups(id)
  const { client } = useClient(id)
  const [showModal, setShowModal] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // ACTION-OUTCOME-1 / P1 §22 — relance en cours de clôture (Terminer). Distinct de
  // `confirmId` (confirmation de suppression, inchangée) et n'affecte jamais le focus/scroll
  // CONTACT-4.2 ci-dessous (état totalement indépendant).
  const [completingFollowup, setCompletingFollowup] = useState<Followup | null>(null)
  // UI-AFFORDANCE-1.1 — relance en cours d'édition (titre/contenu/type/échéance), distincte de
  // `completingFollowup` (clôture P1) et de `confirmId` (suppression) : trois états indépendants.
  const [editingFollowup, setEditingFollowup] = useState<Followup | null>(null)
  const [tasks, setTasks] = useState<UnifiedAction[]>([])
  const [interactionsUpcoming, setInteractionsUpcoming] = useState<UnifiedAction[]>([])
  const [otherLoading, setOtherLoading] = useState(true)
  // FOLLOWUP-HISTORY-1 §16/§17 — l'échange lié à une relance TERMINÉE (source_followup_id) n'est
  // chargé nulle part ailleurs sur cet écran (interactionsUpcoming ci-dessus ne couvre que les
  // interactions futures NON terminées, filtre différent) : une seule requête groupée `IN` sur les
  // relances actuellement `done`, jamais une requête par relance. Map indexée par
  // source_followup_id pour un lookup local O(1) au rendu (§17 du brief).
  const [interactionByFollowupId, setInteractionByFollowupId] = useState<Map<string, Interaction>>(new Map())
  const [interactionsLoaded, setInteractionsLoaded] = useState(false)
  const listRef = useRef<FlatList<UnifiedAction>>(null)
  // §14 — un seul positionnement automatique par ouverture, jamais reboucler sur des
  // re-renders suivants (ex. après un toggle/suppression dans la liste).
  const hasAutoScrolledRef = useRef(false)

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const loadOther = useCallback(async () => {
    if (!id) return
    setOtherLoading(true)
    const [tasksRes, interactionsRes] = await Promise.all([
      supabase
        .from('appointment_tasks')
        .select('id, appointment_id, title, task_type, status, due_at')
        .eq('client_id', id)
        .neq('status', 'cancelled'),
      supabase
        .from('interactions')
        .select('id, interaction_type, subject, scheduled_at')
        .eq('client_id', id)
        .is('completed_at', null)
        .not('scheduled_at', 'is', null),
    ])

    setTasks((tasksRes.data ?? []).map(tk => ({
      id: `task-${tk.id}`,
      source: 'task' as const,
      title: tk.title,
      subtitle: t('followups.source_task'),
      dueDate: tk.due_at ?? new Date().toISOString(),
      done: tk.status === 'done',
      actionType: null,
      appointmentId: tk.appointment_id ?? undefined,
    })))

    setInteractionsUpcoming((interactionsRes.data ?? []).map(it => ({
      id: `interaction-${it.id}`,
      source: 'interaction' as const,
      title: it.subject || t(`interaction_types.${it.interaction_type}` as any),
      subtitle: t('followups.source_interaction'),
      dueDate: it.scheduled_at as string,
      done: false,
      actionType: null,
    })))

    setOtherLoading(false)
  }, [id, t])

  // FOLLOWUP-HISTORY-1 §16/§17/§36 — dépend directement de `followups` (pas d'un effet de focus
  // séparé à maintenir en double) : toute mise à jour de la liste (chargement initial, clôture,
  // réouverture, retour de focus via `refresh()` déjà branché plus bas) redéclenche cette requête
  // groupée. Ne cible que les relances actuellement `done` — une relance active n'a jamais
  // d'échange à afficher ici.
  useEffect(() => {
    const doneIds = followups.filter(f => f.done).map(f => f.id)
    if (doneIds.length === 0) { setInteractionByFollowupId(new Map()); setInteractionsLoaded(true); return }
    let cancelled = false
    setInteractionsLoaded(false)
    getInteractionsBySourceFollowupIds(doneIds)
      .then(list => {
        if (cancelled) return
        setInteractionByFollowupId(new Map(list.map(it => [it.source_followup_id as string, it])))
      })
      .catch(() => { if (!cancelled) setInteractionByFollowupId(new Map()) })
      .finally(() => { if (!cancelled) setInteractionsLoaded(true) })
    return () => { cancelled = true }
  }, [followups])

  // ACTION-FLOW-1 / P0 — `loadOther()` rafraîchissait déjà tâches RDV + interactions à venir au
  // focus, mais jamais `refresh()` de useClientFollowups : une relance terminée depuis un autre
  // écran (fiche Contact, page Relances globale) ou après un aller-retour de navigation (Suite
  // = Planifier un RDV) pouvait laisser `followups` périmé ici, affichant "○ Terminer" alors que
  // `done=true` en base. Les deux sont des useCallback stables ([id]/[id, t]), donc ce
  // useFocusEffect ne se redéclenche qu'au focus réel ou si l'id du contact change — aucune
  // boucle, aucun appel supplémentaire par rendu. Les refresh() existants dans les onSaved des
  // modales restent inchangés (mise à jour immédiate) ; ce focus refresh n'est qu'un filet de
  // sécurité complémentaire pour les cas où la mutation a eu lieu ailleurs.
  useFocusEffect(useCallback(() => { refresh(); loadOther() }, [refresh, loadOther]))

  const unified: UnifiedAction[] = useMemo(() => {
    // Une relance annulée (cancelled_at) n'a jamais été traitée mais ne doit plus apparaître
    // comme "à faire" — distincte de `done`, jamais confondue avec elle (Lot 1.2.1 §10).
    const fromFollowups: UnifiedAction[] = followups.filter(f => !f.cancelled_at).map(f => ({
      id: f.id,
      source: 'followup',
      title: f.title ?? '',
      subtitle: f.content,
      dueDate: f.due_date,
      done: f.done,
      actionType: f.action_type,
      followup: f,
    }))
    return [...fromFollowups, ...tasks, ...interactionsUpcoming].sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    )
  }, [followups, tasks, interactionsUpcoming])

  // CONTACT-4.2 §10/§13/§14 — attend que les données soient chargées, cherche la ressource
  // par id exact (jamais titre/date/index), scrolle une seule fois. focus introuvable (lien
  // périmé/invalide) : ne fait rien, page normale (§12).
  useEffect(() => {
    if (hasAutoScrolledRef.current) return
    if (loading || otherLoading) return
    hasAutoScrolledRef.current = true
    if (!focus) return
    const index = unified.findIndex(u => u.id === focus)
    if (index === -1) return
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 })
    })
  }, [loading, otherLoading, unified, focus])

  async function handleToggle(item: UnifiedAction) {
    if (item.source === 'followup' && item.followup) {
      if (!item.followup.done) {
        // ACTION-OUTCOME-1 / P1 §22 — clôture (false→true) : passe désormais toujours par la
        // modale de clôture professionnelle, jamais un basculement instantané.
        setCompletingFollowup(item.followup)
        return
      }
      // §27 — réouverture (true→false) : comportement existant inchangé, jamais interceptée
      // par P1 (aucune interaction historique n'est jamais supprimée par cette action).
      await toggleFollowupDone(item.followup.id, false)
      refresh()
    } else if (item.source === 'task') {
      // TASK-RDV-1 — symétrique à la branche followup ci-dessus : une tâche déjà terminée
      // affichée ici (la requête inclut status != 'cancelled', donc les tâches "done" y
      // apparaissent) doit se rouvrir au clic, jamais rappeler un "terminer" qui ne faisait
      // rien de nouveau. Même fonction que la fiche RDV, aucune logique séparée.
      const taskId = item.id.replace('task-', '')
      await setAppointmentTaskDone(taskId, !item.done)
      loadOther()
    }
    // Les interactions se gèrent depuis l'onglet Interactions.
  }

  async function handleDelete(item: UnifiedAction) {
    if (item.source === 'followup') {
      await deleteFollowup(item.id)
      refresh()
    } else if (item.source === 'task') {
      await deleteTask(item.id.replace('task-', ''))
      loadOther()
    }
    setConfirmId(null)
  }

  function handlePress(item: UnifiedAction) {
    // NAV-FOCUS-1 — ressource précise (interaction affichée dans cette liste unifiée),
    // même contrat ?focus=<id> que le reste de l'app ; id réel retrouvé en retirant le
    // préfixe 'interaction-' (même convention que task- déjà utilisée dans ce fichier).
    if (item.source === 'interaction') router.push(`/(app)/clients/${id}/interactions?focus=${item.id.replace('interaction-', '')}` as any)
    // UI-AFFORDANCE-1.1 §3 — une tâche RDV n'a pas de formulaire d'édition propre, mais une
    // destination réelle : le RDV qui l'a créée (appointment_tasks.appointment_id).
    else if (item.source === 'task' && item.appointmentId) {
      router.push(`/(app)/appointments/${item.appointmentId}?returnTo=${encodeURIComponent(`/(app)/clients/${id}/followups`)}` as any)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t('followups.title'), headerRight: () => (
        isDesktopWeb ? (
          <TouchableOpacity onPress={() => setShowModal(true)} style={styles.newActionBtn} activeOpacity={0.85}>
            <Text style={styles.newActionBtnText}>+ {t('followups.add')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addBtn} accessibilityLabel={t('followups.add')}>
            <Text style={styles.addBtnText}>+</Text>
          </TouchableOpacity>
        )
      )}} />
      <View style={styles.container}>
        {(loading || otherLoading)
          ? <ActivityIndicator style={styles.loader} color={colors.primary} />
          : <FlatList
              ref={listRef}
              data={unified}
              keyExtractor={f => f.id}
              // CONTACT-4.2 §10 — filet de sécurité standard FlatList : l'item ciblé peut ne pas
              // être encore mesuré au premier essai (liste tout juste montée), un seul retry.
              onScrollToIndexFailed={(info) => {
                setTimeout(() => {
                  listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })
                }, 100)
              }}
              renderItem={({ item }) => {
                // CONTACT-4.2 §8/§9 — mise en évidence réservée à LA carte exactement ciblée par
                // ?focus=<id> (jamais toute la liste, hors périmètre de ce lot) : couleur selon
                // l'échéance propre de cette ressource, bordure renforcée pour la distinguer
                // d'une simple urgence ("c'est celle sur laquelle vous avez cliqué").
                const isFocused = item.id === focus
                const urgency = isFocused && !item.done ? focusUrgency(item.dueDate) : null
                const focusStyle = !isFocused ? null
                  : urgency === 'overdue' ? styles.cardFocusedOverdue
                  : urgency === 'today' ? styles.cardFocusedToday
                  : styles.cardFocused
                // UI-AFFORDANCE-1.1 §3 — une tâche RDV n'a de destination réelle que si son
                // appointment_id a bien été résolu (toujours le cas en pratique, cf. audit).
                const contentIsNavigable = item.source === 'interaction' || (item.source === 'task' && !!item.appointmentId)
                // FOLLOWUP-HISTORY-1 §4/§16/§17 — au plus une interaction directe par relance
                // (index unique partiel, §18 du brief) : lookup O(1), jamais recalculé par un
                // second état. undefined tant que non chargé OU si la relance est active/a été
                // clôturée simplement (aucune confusion possible entre les deux cas, départagés
                // par `interactionsLoaded` au rendu ci-dessous).
                const linkedInteraction = item.source === 'followup' && item.done ? interactionByFollowupId.get(item.id) : undefined
                // UI-AFFORDANCE-1.3 — le contenu central (titre/badges/date) : un vrai Pressable
                // uniquement quand il a une destination réelle (interaction, tâche RDV) ; un
                // simple View pour une relance, qui n'ouvre rien depuis cette zone (§5 du brief —
                // "Modifier ›" reste le seul moyen d'agir dessus).
                const infoContent = (
                  <>
                    <View style={styles.badgeRow}>
                      {item.actionType ? (
                        <View style={styles.actionTypeBadge}>
                          <Text style={styles.actionTypeIcon}>{ACTION_ICONS[item.actionType]}</Text>
                          <Text style={styles.actionTypeText}>{t(`next_action_types.${item.actionType}`)}</Text>
                        </View>
                      ) : null}
                      {item.source !== 'followup' ? (
                        <View style={[styles.sourceBadge, item.source === 'interaction' && styles.sourceBadgeInteraction]}>
                          <Text style={[styles.sourceBadgeText, item.source === 'interaction' && styles.sourceBadgeTextInteraction]}>
                            {item.subtitle}
                          </Text>
                        </View>
                      ) : null}
                      {isFocused && urgency ? (
                        <View style={styles.focusUrgencyBadge}>
                          <Text style={[styles.focusUrgencyBadgeText, { color: urgency === 'overdue' ? colors.danger : colors.warning }]}>
                            {t(urgency === 'overdue' ? 'followups.overdue_badge' : 'followups.today_badge')}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {item.title ? <Text style={[styles.title, item.done && styles.doneText]}>{item.title}</Text> : null}
                    {item.source === 'followup' && item.subtitle ? (
                      <Text style={[styles.content, item.done && styles.doneText]} numberOfLines={2}>{item.subtitle}</Text>
                    ) : null}
                    <Text style={styles.date}>{formatDate(item.dueDate, locale)}</Text>
                    {/* FOLLOWUP-HISTORY-1 §4/§5/§8/§9/§10 — synthèse compacte de l'échange
                        (résultat · extrait du compte-rendu), 1-2 lignes maximum, jamais le texte
                        intégral recopié. "Clôturée simplement" seulement une fois la recherche
                        d'échange terminée (§ pas de flash "clôturée simplement" pendant le
                        chargement). Aucune de ces données n'est stockée sur `followups` — lues
                        ici uniquement depuis l'interaction historique (§2/§22 du brief). */}
                    {item.source === 'followup' && item.done && interactionsLoaded ? (
                      linkedInteraction ? (
                        <Text style={styles.exchangeSummary} numberOfLines={2}>
                          {exchangeSummaryText(linkedInteraction, t)}
                        </Text>
                      ) : (
                        <Text style={styles.closedSimpleText}>{t('followups.closed_simple_label')}</Text>
                      )
                    ) : null}
                  </>
                )
                return (
                <Card style={[item.done && styles.done, focusStyle]}>
                  {/* UI-AFFORDANCE-1.3 — simple View non interactif (jamais plus un
                      TouchableOpacity) : CompleteToggle/OpenActionLink/suppression sont des
                      contrôles FRÈRES, jamais imbriqués dans un autre élément interactif — sur
                      web (react-native-web), un <button> HTML dans un <button> est invalide et
                      provoque une erreur d'hydratation. */}
                  <View style={styles.row}>
                    {item.source !== 'interaction' ? (
                      // UI-AFFORDANCE-1.2 §4/§7/§8 — action métier explicite. Relance active :
                      // ouvre FollowupCompletionModal (P1, inchangé) ; relance terminée : clic
                      // rouvre (comportement existant préservé, §27 du lot P1) ; tâche RDV :
                      // TASK-RDV-1 — désormais réversible ici aussi (même fonction que la fiche
                      // RDV, setAppointmentTaskDone), une tâche déjà terminée se rouvre au clic
                      // au lieu de rappeler silencieusement "terminer" sans effet nouveau.
                      <CompleteToggle
                        done={item.done}
                        onPress={() => handleToggle(item)}
                        activeLabel={t('clients.finish_action')}
                        doneLabel={t('followups.done')}
                        accessibilityLabel={
                          item.done
                            ? `${t('followups.done')} — ${item.title}`
                            : `${t('clients.finish_action')} — ${item.title}`
                        }
                        accessibilityHint={item.done ? (item.source === 'followup' ? t('followups.reopen_hint') : t('appointments.task_reopen_action')) : undefined}
                      />
                    ) : (
                      <Text style={styles.checkboxText}>📅</Text>
                    )}
                    {contentIsNavigable ? (
                      <TouchableOpacity
                        style={styles.info}
                        onPress={() => handlePress(item)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('common.open')} ${item.title ?? ''}`}
                      >
                        {infoContent}
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.info}>
                        {infoContent}
                      </View>
                    )}
                    <View style={styles.rowActions}>
                      {/* UI-AFFORDANCE-1.1 §2/§3 — une vraie relance ouvre son formulaire
                          d'édition ("Modifier", jamais lié à la case à cocher) ; une tâche RDV
                          n'a pas de formulaire propre mais une destination réelle (le RDV qui
                          l'a créée) ; une interaction ouvre déjà la page Interactions (§ NAV-
                          FOCUS-1, inchangé, cf. UI-AFFORDANCE-1).
                          FOLLOWUP-HISTORY-1 §11/§12 — une relance TERMINÉE AVEC échange
                          remplace "Modifier ›" par "Voir l'échange ›" (jamais les deux à la
                          fois, §20 : le formulaire d'édition du compte-rendu vit déjà dans
                          l'onglet Interactions, pas de second formulaire ici) : navigue vers
                          EXACTEMENT cette interaction via le même contrat ?focus=<id> que
                          NAV-FOCUS-1 (réutilisé, aucune nouvelle route créée, §11 du brief).
                          Une relance clôturée simplement (ou active) garde "Modifier ›". */}
                      {item.source === 'followup' && item.followup && linkedInteraction ? (
                        <OpenActionLink
                          label={t('followups.view_exchange')}
                          onPress={() => router.push(`/(app)/clients/${id}/interactions?focus=${linkedInteraction.id}` as any)}
                          accessibilityLabel={`${t('followups.view_exchange')} — ${item.title}`}
                        />
                      ) : item.source === 'followup' && item.followup ? (
                        <OpenActionLink
                          label={t('common.edit')}
                          onPress={() => setEditingFollowup(item.followup!)}
                          accessibilityLabel={`${t('common.edit')} ${item.title}`}
                        />
                      ) : item.source === 'task' && item.appointmentId ? (
                        // Corrigé — un utilisateur clique naturellement sur le libellé "Ouvrir ›"
                        // lui-même, pas seulement sur le titre à côté. Reste un frère de la zone
                        // de contenu (jamais imbriqué dedans), donc aucun risque de <button>
                        // imbriqué sur web (cf. UI-AFFORDANCE-1.3).
                        <OpenActionLink
                          label={t('common.open')}
                          onPress={() => handlePress(item)}
                          accessibilityLabel={`${t('common.open')} ${item.title ?? ''}`}
                        />
                      ) : item.source === 'interaction' ? (
                        <OpenActionLink
                          label={t('common.open')}
                          onPress={() => handlePress(item)}
                          accessibilityLabel={`${t('common.open')} ${item.title ?? ''}`}
                        />
                      ) : null}
                      {item.source !== 'interaction' ? (
                        confirmId === item.id ? (
                          <View style={styles.inlineConfirm}>
                            <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setConfirmId(null)}>
                              <Text style={styles.confirmCancelText}>{t('common.cancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.confirmDeleteBtn} onPress={() => handleDelete(item)}>
                              <Text style={styles.confirmDeleteText}>{t('common.delete')}</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity onPress={() => setConfirmId(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Text style={styles.deleteIcon}>🗑</Text>
                          </TouchableOpacity>
                        )
                      ) : null}
                    </View>
                  </View>
                </Card>
                )
              }}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<EmptyState message={t('followups.none')} icon="🔔" />}
            />
        }
      </View>
      {showModal && (
        <FollowupModal
          clientId={id}
          userId={session?.user.id ?? ''}
          currentPipeline={client?.pipeline_stage ?? 'new_lead'}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); refresh() }}
        />
      )}
      {/* UI-AFFORDANCE-1.1 — même Modal que la création, en mode édition (§4 : réutiliser,
          jamais un second formulaire). Ne touche jamais `done` : la clôture reste exclusivement
          gérée par FollowupCompletionModal (P1). */}
      {editingFollowup && (
        <FollowupModal
          clientId={id}
          userId={session?.user.id ?? ''}
          currentPipeline={client?.pipeline_stage ?? 'new_lead'}
          editingFollowup={editingFollowup}
          onClose={() => setEditingFollowup(null)}
          onSaved={() => { setEditingFollowup(null); refresh() }}
        />
      )}
      {completingFollowup && (
        <FollowupCompletionModal
          followup={completingFollowup}
          userId={session?.user.id ?? ''}
          onClose={() => setCompletingFollowup(null)}
          onSaved={() => { setCompletingFollowup(null); refresh() }}
        />
      )}
    </>
  )
}

function FollowupModal({ clientId, userId, currentPipeline, editingFollowup, onClose, onSaved }: {
  clientId: string; userId: string; currentPipeline: PipelineStage; editingFollowup?: Followup; onClose: () => void; onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { getPipelineStageLabel } = useAppConfig()
  const isEditing = !!editingFollowup
  const [actionType, setActionType] = useState<NextActionType | null>(editingFollowup?.action_type ?? null)
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>(currentPipeline)
  const [title, setTitle] = useState(editingFollowup?.title ?? '')
  const [content, setContent] = useState(editingFollowup?.content ?? '')
  const [dueDate, setDueDate] = useState(editingFollowup?.due_date ?? new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showDueCal, setShowDueCal] = useState(false)
  const [dayAppointments, setDayAppointments] = useState<CalendarBusyAppointment[]>([])

  // RDV déjà planifiés (tous contacts confondus) — pour voir la charge du jour avant de
  // fixer l'échéance de la relance, même principe que pour la date de prochain RDV.
  useEffect(() => {
    const from = new Date().toISOString()
    const to = new Date(Date.now() + 90 * 86400000).toISOString()
    supabase.from('appointments').select('start_at, end_at, title')
      .eq('user_id', userId)
      .in('status', ['scheduled', 'rescheduled'])
      .gte('start_at', from)
      .lte('start_at', to)
      .then(({ data }) => { if (data) setDayAppointments(data) })
  }, [userId])

  async function handleSave() {
    if (!title.trim() && !content.trim()) {
      setErrorMsg(t('followups.error_title_or_desc'))
      return
    }
    setLoading(true)
    try {
      if (editingFollowup) {
        // UI-AFFORDANCE-1.1 §2/§5 — uniquement titre/contenu/type/échéance ; jamais done,
        // pipeline_stage, ni aucun champ structurel (appointment_id, source_interaction_id,
        // closure_action_key, automation_rule_id, order_id).
        await updateFollowup(editingFollowup.id, {
          title: title.trim() || null,
          content: content.trim() || null,
          due_date: dueDate,
          action_type: actionType,
        })
      } else {
        await createFollowup(userId, {
          client_id: clientId,
          title: title.trim() || null,
          content: content.trim() || null,
          due_date: dueDate,
          done: false,
          action_type: actionType,
          pipeline_stage: pipelineStage,
        })
      }
      onSaved()
    } catch (e) {
      console.error(editingFollowup ? '[updateFollowup]' : '[createFollowup]', e)
      setErrorMsg(t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose}><Text style={styles.modalCancel}>{t('common.cancel')}</Text></TouchableOpacity>
        <Text style={styles.modalTitle}>{isEditing ? t('followups.edit_title') : t('followups.add')}</Text>
        <Button label={t('common.save')} size="sm" onPress={handleSave} loading={loading} />
      </View>
      <ScrollView style={{ padding: 16 }} contentContainerStyle={{ gap: 12 }}>
        {/* UI-AFFORDANCE-1.1 §2 — édition volontairement limitée à titre/contenu/type/échéance ;
            pipeline_stage n'est jamais montré ni modifié depuis cette Modal en mode édition. */}
        {!isEditing ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.fieldLabel}>{t('clients.fields.pipeline_stage')}</Text>
            <View style={styles.actionTypeRow}>
              {PIPELINE_STAGES.map(stage => (
                <TouchableOpacity key={stage} style={[styles.actionTypeChip, pipelineStage === stage && styles.actionTypeChipActive]} onPress={() => setPipelineStage(stage)}>
                  <Text style={[styles.actionTypeChipLabel, pipelineStage === stage && styles.actionTypeChipLabelActive]}>{getPipelineStageLabel(stage)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}
        <View style={{ gap: 8 }}>
          <Text style={styles.fieldLabel}>{t('followups.action_type')}</Text>
          <View style={styles.actionTypeRow}>
            {ACTION_TYPES.map(at => (
              <TouchableOpacity
                key={at}
                style={[styles.actionTypeChip, actionType === at && styles.actionTypeChipActive]}
                onPress={() => setActionType(actionType === at ? null : at)}
                activeOpacity={0.7}
              >
                <Text style={styles.actionTypeChipIcon}>{ACTION_ICONS[at]}</Text>
                <Text style={[styles.actionTypeChipLabel, actionType === at && styles.actionTypeChipLabelActive]}>
                  {t(`next_action_types.${at}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <Input label={t('followups.title_label')} value={title} onChangeText={setTitle} />
        <Input label={`${t('followups.description')} (${t('common.optional')})`} value={content} onChangeText={setContent} />
        <View style={{ gap: 8 }}>
          <Text style={styles.fieldLabel}>{t('followups.due_date')}</Text>
          <TouchableOpacity style={styles.dueDateBtn} onPress={() => setShowDueCal(true)} activeOpacity={0.75}>
            <Text style={styles.dueDateBtnText}>{formatDate(dueDate, locale)}</Text>
          </TouchableOpacity>
        </View>
        {errorMsg ? <Text style={styles.errorMsg}>{errorMsg}</Text> : null}
      </ScrollView>
      <CalendarPickerModal
        visible={showDueCal}
        value={dueDate}
        locale={locale}
        dayAppointments={dayAppointments}
        onClose={() => setShowDueCal(false)}
        onConfirm={setDueDate}
      />
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bgDim },
  list:       { padding: 12, gap: 8 },
  loader:     { marginTop: 40 },
  addBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addBtnText: { color: '#fff', fontSize: 22, lineHeight: 28 },
  // UI-CREATE-1 — création principale desktop : icône + texte explicite, jamais un rond "+"
  // isolé (règle §3/§8). Couleur primaire existante, aucune nouvelle teinte.
  newActionBtn:     { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginRight: 12 },
  newActionBtnText: { color: '#fff', fontSize: 14, fontFamily: fonts.semibold },
  done:       { opacity: 0.5 },
  // CONTACT-4.2 — carte exactement ciblée par ?focus=<id> uniquement (jamais toute la liste).
  cardFocused:        { borderWidth: 2, borderColor: colors.primary },
  cardFocusedOverdue: { borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.dangerLight },
  cardFocusedToday:   { borderWidth: 2, borderColor: colors.warning, backgroundColor: colors.warningLight },
  focusUrgencyBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999, backgroundColor: colors.card },
  focusUrgencyBadgeText: { fontSize: 10.5, fontFamily: fonts.bold, letterSpacing: 0.4 },
  row:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkboxText: { fontSize: 20 },
  info:       { flex: 1, gap: 3 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  badgeRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  title:      { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  content:    { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary },
  doneText:   { textDecorationLine: 'line-through', color: colors.textTertiary },
  // FOLLOWUP-HISTORY-1 §5/§26 — synthèse compacte, jamais une couleur d'urgence (fait déjà
  // survenu, pas un signal CRM) — même teinte neutre que le résultat d'interaction dans
  // clients/[id]/interactions.tsx (colors.primaryAction) pour rester visuellement cohérent avec
  // l'endroit où ce même résultat est éditable.
  exchangeSummary:  { fontSize: 13, fontFamily: fonts.medium, color: colors.primaryAction },
  closedSimpleText: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
  date:       { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  deleteIcon: { fontSize: 16, paddingTop: 2 },

  sourceBadge:              { backgroundColor: colors.bgDim, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  sourceBadgeInteraction:   { backgroundColor: colors.secondaryLight },
  sourceBadgeText:          { fontSize: 10, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  sourceBadgeTextInteraction: { color: colors.secondary },

  inlineConfirm:      { flexDirection: 'column', gap: 4, alignItems: 'flex-end' },
  confirmCancelBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  confirmCancelText:  { fontSize: 12, fontFamily: fonts.medium, color: colors.text },
  confirmDeleteBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.danger },
  confirmDeleteText:  { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },

  errorMsg:    { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle:  { fontSize: 17, fontFamily: fonts.semibold, color: colors.text },
  modalCancel: { fontSize: 16, fontFamily: fonts.body, color: colors.primary },

  fieldLabel:           { fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  dueDateBtn:     { backgroundColor: colors.bgDim, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border },
  dueDateBtnText: { fontSize: 15, fontFamily: fonts.medium, color: colors.text },
  actionTypeRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionTypeChip:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  actionTypeChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  actionTypeChipIcon:   { fontSize: 13 },
  actionTypeChipLabel:  { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  actionTypeChipLabelActive: { color: colors.primary, fontFamily: fonts.semibold },

  actionTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  actionTypeIcon:  { fontSize: 11 },
  actionTypeText:  { fontSize: 11, fontFamily: fonts.semibold, color: colors.primaryAction },
  })
}
