import React, { useState, useEffect, useCallback } from 'react';
import {
  UserProfile,
  ProUpgradeRequest,
  AdBanner,
  AdPage,
  AdPosition,
  AdPlacement,
  RoutineCategoryConfig,
  Language,
} from '../types';
import { getLocalTodayDate, addDaysToDateStr } from '../utils/dateUtils';
import {
  ShieldCheck,
  Users,
  Crown,
  Megaphone,
  Layers,
  BarChart3,
  Search,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  RefreshCw,
  Upload,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  X,
} from 'lucide-react';

interface AdminPanelViewProps {
  token: string;
  lang: Language;
  onUserDataChanged: () => void;
  onSessionExpired?: () => void;
}

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  freeUsers: number;
  proUsers: number;
  routinesCreated: number;
  dailyActiveUsers: number;
  totalLogs: number;
  doneLogs: number;
  skippedLogs: number;
  missedLogs: number;
  overallCompletionRate: number;
  proSubscriptionsCount: number;
  verifiedRevenueNpr: number;
  approvedPaymentsCount: number;
  pendingPaymentsCount: number;
}

const ALL_AD_PAGES: { id: AdPage; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'planner', label: 'Planner' },
  { id: 'reports', label: 'Reports' },
  { id: 'profile', label: 'Profile' },
];

const ALL_AD_POSITIONS: { id: AdPosition; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
];

function buildPlacementsFromSelection(
  pages: AdPage[],
  positions: AdPosition[]
): AdPlacement[] {
  const result: AdPlacement[] = [];
  for (const page of ALL_AD_PAGES.map((p) => p.id)) {
    if (!pages.includes(page)) continue;
    for (const pos of ALL_AD_POSITIONS.map((p) => p.id)) {
      if (!positions.includes(pos)) continue;
      result.push(`${page}_${pos}` as AdPlacement);
    }
  }
  return result;
}

function extractSelectionFromAd(ad: AdBanner): {
  pages: AdPage[];
  positions: AdPosition[];
} {
  if (Array.isArray(ad.pages) && Array.isArray(ad.positions)) {
    return {
      pages: ALL_AD_PAGES.map((p) => p.id).filter((id) =>
        ad.pages!.includes(id)
      ),
      positions: ALL_AD_POSITIONS.map((p) => p.id).filter((id) =>
        ad.positions!.includes(id)
      ),
    };
  }

  const rawList: AdPlacement[] = Array.isArray(ad.placements)
    ? ad.placements
    : ad.placement
    ? [ad.placement]
    : [
        'home_top',
        'home_bottom',
        'planner_top',
        'planner_bottom',
        'reports_top',
        'reports_bottom',
        'profile_top',
        'profile_bottom',
      ];

  const pageSet = new Set<AdPage>();
  const posSet = new Set<AdPosition>();
  for (const item of rawList) {
    const [pg, ps] = String(item).split('_') as [AdPage, AdPosition];
    if (['home', 'planner', 'reports', 'profile'].includes(pg)) {
      pageSet.add(pg);
    }
    if (['top', 'bottom'].includes(ps)) {
      posSet.add(ps);
    }
  }

  return {
    pages: ALL_AD_PAGES.map((p) => p.id).filter((id) => pageSet.has(id)),
    positions: ALL_AD_POSITIONS.map((p) => p.id).filter((id) =>
      posSet.has(id)
    ),
  };
}

export const AdminPanelView: React.FC<AdminPanelViewProps> = ({
  token,
  lang,
  onUserDataChanged,
  onSessionExpired,
}) => {
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'users' | 'pro' | 'routines' | 'ads'
  >('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [proRequests, setProRequests] = useState<ProUpgradeRequest[]>([]);
  const [ads, setAds] = useState<AdBanner[]>([]);
  const [adsEnabledGlobal, setAdsEnabledGlobal] = useState(true);
  const [categories, setCategories] = useState<RoutineCategoryConfig[]>([]);

  // Search & editing states
  const [userSearch, setUserSearch] = useState('');
  const [adminNotesMap, setAdminNotesMap] = useState<Record<string, string>>({});
  const [proExpiryMap, setProExpiryMap] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState('');

  // Manual Banner Ad Form (Create & Edit)
  const defaultStart = getLocalTodayDate();
  const defaultEnd = addDaysToDateStr(defaultStart, 180);
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);
  const [bannerImageUrl, setBannerImageUrl] = useState('');
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerTargetUrl, setBannerTargetUrl] = useState('https://');
  const [bannerActive, setBannerActive] = useState(true);
  const [bannerStartDate, setBannerStartDate] = useState(defaultStart);
  const [bannerEndDate, setBannerEndDate] = useState(defaultEnd);
  const [bannerPages, setBannerPages] = useState<AdPage[]>([
    'home',
    'planner',
    'reports',
    'profile',
  ]);
  const [bannerPositions, setBannerPositions] = useState<AdPosition[]>([
    'top',
    'bottom',
  ]);
  const [bannerPriority, setBannerPriority] = useState('10');

  // Preserved Google AdSense Form
  const [adTitle, setAdTitle] = useState('');
  const [adType, setAdType] = useState<'manual' | 'adsense'>('adsense');
  const [adPlacement, setAdPlacement] = useState<AdPlacement>('planner_bottom');
  const [adTargetUrl, setAdTargetUrl] = useState('#upgrade');
  const [adSenseSlot, setAdSenseSlot] = useState('');
  const [adStartDate, setAdStartDate] = useState(defaultStart);
  const [adEndDate, setAdEndDate] = useState(defaultEnd);
  const [adPriority, setAdPriority] = useState('5');

  // New Category Form
  const [catNameEn, setCatNameEn] = useState('');
  const [catNameNe, setCatNameNe] = useState('');
  const [catIcon, setCatIcon] = useState('✨');
  const [catSuggestedEn, setCatSuggestedEn] = useState('');
  const [catSuggestedNe, setCatSuggestedNe] = useState('');
  const [catDefaultTime, setCatDefaultTime] = useState('08:00');

  const fetchAdminOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          onSessionExpired?.();
        }
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to load Admin Panel data.');
      }
      const data = await res.json();
      setStats(data.stats);
      setUsers(data.users || []);
      setProRequests(data.proRequests || []);
      setAds(data.ads || []);
      setAdsEnabledGlobal(Boolean(data.adsEnabledGlobal));
      setCategories(data.categories || []);

      const notesInit: Record<string, string> = {};
      (data.proRequests || []).forEach((pr: ProUpgradeRequest) => {
        notesInit[pr.id] = pr.adminNotes || '';
      });
      setAdminNotesMap(notesInit);

      const expiryInit: Record<string, string> = {};
      (data.users || []).forEach((u: UserProfile) => {
        expiryInit[u.uid] = u.proExpiry || '';
      });
      setProExpiryMap(expiryInit);
    } catch (err: any) {
      setError(err?.message || 'Admin authorization failed.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAdminOverview();
  }, [fetchAdminOverview]);

  const showFlash = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(''), 3000);
  };

  const handleUpdateUser = async (
    uid: string,
    payload: Partial<{ status: 'active' | 'suspended'; isPro: boolean; proExpiry: string }>
  ) => {
    try {
      const res = await fetch(`/api/admin/users/${uid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update user');
      showFlash(lang === 'ne' ? 'प्रयोगकर्ता विवरण अद्यावधिक भयो।' : 'User updated successfully.');
      await fetchAdminOverview();
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to update user');
    }
  };

  const handleReviewProRequest = async (
    reqId: string,
    status: 'approved' | 'rejected'
  ) => {
    try {
      const res = await fetch(`/api/admin/pro-requests/${reqId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status,
          adminNotes: adminNotesMap[reqId] || '',
        }),
      });
      if (!res.ok) throw new Error('Failed to update Pro request');
      showFlash(
        status === 'approved'
          ? 'Pro subscription approved & activated (Rs.99 / month or Rs.999 / year verified).'
          : 'Pro request rejected.'
      );
      await fetchAdminOverview();
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Error reviewing request');
    }
  };

  const handleToggleGlobalAds = async (nextVal: boolean) => {
    try {
      await fetch('/api/admin/ads/global-toggle', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ adsEnabledGlobal: nextVal }),
      });
      setAdsEnabledGlobal(nextVal);
      showFlash(nextVal ? 'Ads enabled for Free users.' : 'All ads disabled.');
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Error toggling ads');
    }
  };

  const handleBannerFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (PNG, JPG, WEBP, GIF, SVG).');
      return;
    }

    setBannerUploading(true);
    setError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/admin/ads/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dataUrl }),
      });

      if (res.ok) {
        const data = await res.json();
        setBannerImageUrl(data.imageUrl || dataUrl);
        showFlash('Banner image uploaded and ready to save.');
      } else {
        setBannerImageUrl(dataUrl);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to upload banner image');
    } finally {
      setBannerUploading(false);
      e.target.value = '';
    }
  };

  const toggleBannerPage = (page: AdPage) => {
    setBannerPages((prev) =>
      prev.includes(page) ? prev.filter((p) => p !== page) : [...prev, page]
    );
  };

  const toggleBannerPosition = (pos: AdPosition) => {
    setBannerPositions((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    );
  };

  const resetManualBannerForm = () => {
    setEditingBannerId(null);
    setBannerImageUrl('');
    setBannerTitle('');
    setBannerTargetUrl('https://');
    setBannerActive(true);
    setBannerStartDate(defaultStart);
    setBannerEndDate(defaultEnd);
    setBannerPages(['home', 'planner', 'reports', 'profile']);
    setBannerPositions(['top', 'bottom']);
    setBannerPriority('10');
  };

  const handleStartEditBanner = (ad: AdBanner) => {
    const { pages, positions } = extractSelectionFromAd(ad);
    setEditingBannerId(ad.id);
    setBannerImageUrl(ad.imageUrl || '');
    setBannerTitle(ad.title || '');
    setBannerTargetUrl(ad.targetUrl || 'https://');
    setBannerActive(Boolean(ad.active));
    setBannerStartDate(ad.startDate || defaultStart);
    setBannerEndDate(ad.endDate || defaultEnd);
    setBannerPages(pages);
    setBannerPositions(positions);
    setBannerPriority(String(ad.priority || 10));
    setError('');
  };

  const handleSaveManualBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanImg = bannerImageUrl.trim();
    const cleanTitle = bannerTitle.trim();
    const cleanUrl = bannerTargetUrl.trim() || '#upgrade';

    if (!cleanImg && !cleanTitle) {
      setError('Please upload a banner image (or provide a banner title).');
      return;
    }

    if (bannerPages.length === 0 || bannerPositions.length === 0) {
      setError(
        'Please select at least one page (Home, Planner, Reports, Profile) and one position (Top, Bottom).'
      );
      return;
    }

    const computedPlacements = buildPlacementsFromSelection(
      bannerPages,
      bannerPositions
    );

    try {
      const url = editingBannerId
        ? `/api/admin/ads/${editingBannerId}`
        : '/api/admin/ads';
      const method = editingBannerId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: cleanTitle,
          type: 'manual',
          placement: computedPlacements[0] || 'home_top',
          placements: computedPlacements,
          pages: bannerPages,
          positions: bannerPositions,
          imageUrl: cleanImg,
          targetUrl: cleanUrl,
          active: bannerActive,
          startDate: bannerStartDate || defaultStart,
          endDate: bannerEndDate || defaultEnd,
          priority: Number(bannerPriority) || 10,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save banner ad');
      }

      showFlash(
        editingBannerId
          ? 'Manual banner ad updated successfully.'
          : 'Manual banner ad saved to selected placements.'
      );
      resetManualBannerForm();
      await fetchAdminOverview();
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not save manual banner');
    }
  };

  const handleQuickUpdatePlacements = async (
    ad: AdBanner,
    nextPages: AdPage[],
    nextPositions: AdPosition[]
  ) => {
    const nextPlacements = buildPlacementsFromSelection(
      nextPages,
      nextPositions
    );
    try {
      const res = await fetch(`/api/admin/ads/${ad.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pages: nextPages,
          positions: nextPositions,
          placements: nextPlacements,
          placement: nextPlacements[0] || ad.placement || 'home_top',
        }),
      });
      if (!res.ok) throw new Error('Failed to update banner placements');
      showFlash('Banner placements updated.');
      await fetchAdminOverview();
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not update banner placements');
    }
  };

  const handleCreateAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adTitle.trim() && !adSenseSlot.trim()) return;
    try {
      const res = await fetch('/api/admin/ads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: adTitle.trim() || `AdSense (${adSenseSlot.trim()})`,
          type: adType,
          placement: adPlacement,
          targetUrl: adTargetUrl,
          adSenseSlot: adSenseSlot.trim(),
          active: true,
          startDate: adStartDate,
          endDate: adEndDate,
          priority: Number(adPriority) || 5,
        }),
      });
      if (!res.ok) throw new Error('Failed to create AdSense placement');
      setAdTitle('');
      setAdSenseSlot('');
      showFlash('AdSense placement saved.');
      await fetchAdminOverview();
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not create AdSense placement');
    }
  };

  const handleSetAdActive = async (ad: AdBanner, nextActive: boolean) => {
    try {
      await fetch(`/api/admin/ads/${ad.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active: nextActive }),
      });
      if (nextActive) {
        setAdsEnabledGlobal(true);
      }
      showFlash(
        nextActive
          ? 'Banner activated for Free users.'
          : 'Banner deactivated.'
      );
      await fetchAdminOverview();
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not update ad');
    }
  };

  const handleToggleAdActive = async (ad: AdBanner) => {
    await handleSetAdActive(ad, !ad.active);
  };

  const handleDeleteAd = async (adId: string) => {
    try {
      await fetch(`/api/admin/ads/${adId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (editingBannerId === adId) {
        resetManualBannerForm();
      }
      showFlash('Ad deleted.');
      await fetchAdminOverview();
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not delete ad');
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catNameEn.trim()) return;
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nameEn: catNameEn.trim(),
          nameNe: catNameNe.trim() || catNameEn.trim(),
          icon: catIcon || '✨',
          suggestedTitleEn: catSuggestedEn.trim() || catNameEn.trim(),
          suggestedTitleNe: catSuggestedNe.trim() || catNameNe.trim() || catNameEn.trim(),
          defaultTime: catDefaultTime || '08:00',
        }),
      });
      if (!res.ok) throw new Error('Failed to add category');
      setCatNameEn('');
      setCatNameNe('');
      setCatSuggestedEn('');
      setCatSuggestedNe('');
      showFlash('Routine category added.');
      await fetchAdminOverview();
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to add category');
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    try {
      await fetch(`/api/admin/categories/${catId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchAdminOverview();
      onUserDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete category');
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  if (loading && !stats) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="h-24 bg-slate-200 dark:bg-slate-800 rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-teal-600 text-white flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {lang === 'ne' ? 'एडमिन प्यानल (Admin Panel)' : 'Admin Control Panel'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {lang === 'ne'
                ? 'प्रयोगकर्ता, प्रो सदस्यता (Rs.99 / month · Rs.999 / year), रुटिन विधा र विज्ञापन व्यवस्थापन'
                : 'Server-authorized management for Users, Pro Subscriptions (Rs.99 / month · Rs.999 / year), Categories & Ads'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchAdminOverview}
          className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-800 dark:text-teal-200">
          {actionMessage}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Segmented Navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-xl overflow-x-auto">
        {(
          [
            { id: 'dashboard', label: 'Dashboard & Analytics', icon: BarChart3 },
            { id: 'users', label: `Users (${users.length})`, icon: Users },
            {
              id: 'pro',
              label: `Pro Rs.99 / Rs.999 (${stats?.pendingPaymentsCount || 0} Pending)`,
              icon: Crown,
            },
            { id: 'routines', label: 'Routine Categories', icon: Layers },
            { id: 'ads', label: 'Ads Manager', icon: Megaphone },
          ] as const
        ).map((tab) => {
          const IconComp = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                active
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <IconComp className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: DASHBOARD & ANALYTICS */}
      {activeTab === 'dashboard' && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Total Users</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                {stats.totalUsers}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Active: {stats.activeUsers} · DAU: {stats.dailyActiveUsers}
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Free vs Pro Users
              </p>
              <p className="text-2xl font-bold font-mono tabular-nums text-teal-700 dark:text-teal-400 mt-1">
                {stats.proUsers} Pro
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Free Users: {stats.freeUsers}
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Routines & Completion
              </p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                {stats.routinesCreated}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Completion Rate: {stats.overallCompletionRate}%
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verified Revenue (Rs.99 / Rs.999)
              </p>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                Rs. {stats.verifiedRevenueNpr}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {stats.approvedPaymentsCount} verified payments
              </p>
            </div>
          </div>

          {/* Detailed Activity Breakdown */}
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
              Platform Routine Execution Breakdown
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-xs text-slate-500 block">Total Logged Actions</span>
                <span className="font-mono tabular-nums font-semibold text-lg">
                  {stats.totalLogs}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Completed Routines</span>
                <span className="font-mono tabular-nums font-semibold text-lg text-emerald-600">
                  {stats.doneLogs}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Skipped Routines</span>
                <span className="font-mono tabular-nums font-semibold text-lg text-amber-600">
                  {stats.skippedLogs}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Missed Routines</span>
                <span className="font-mono tabular-nums font-semibold text-lg text-red-600">
                  {stats.missedLogs}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USER MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search users by name or email..."
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          <div className="space-y-3">
            {filteredUsers.map((u) => (
              <div
                key={u.uid}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white">
                      {u.name}
                    </span>
                    <span className="text-xs text-slate-500">
                      · {u.role === 'admin' ? 'Admin' : u.isPro ? 'Pro Member' : 'Free Member'} ·{' '}
                      {u.status === 'active' ? 'Active' : 'Suspended'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    {u.email} · Registered: {u.createdAt.slice(0, 10)}
                  </p>
                  {u.isPro && (
                    <p className="text-xs text-teal-700 dark:text-teal-400 font-mono">
                      Pro Expiry: {u.proExpiry || 'Unlimited'}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={proExpiryMap[u.uid] || ''}
                    onChange={(e) =>
                      setProExpiryMap((prev) => ({
                        ...prev,
                        [u.uid]: e.target.value,
                      }))
                    }
                    className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                    title="Pro Expiry Date"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateUser(u.uid, {
                        isPro: !u.isPro,
                        proExpiry: !u.isPro
                          ? proExpiryMap[u.uid] ||
                            addDaysToDateStr(getLocalTodayDate(), 30)
                          : '',
                      })
                    }
                    className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      u.isPro
                        ? 'border-amber-300 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                        : 'bg-teal-700 text-white border-teal-700 hover:bg-teal-800'
                    }`}
                  >
                    {u.isPro ? 'Revoke Pro' : 'Grant Pro (Rs.99/mo · Rs.999/yr)'}
                  </button>

                  {u.role !== 'admin' && (
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateUser(u.uid, {
                          status: u.status === 'active' ? 'suspended' : 'active',
                        })
                      }
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        u.status === 'active'
                          ? 'border-red-300 text-red-700 dark:text-red-300 hover:bg-red-50'
                          : 'border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50'
                      }`}
                    >
                      {u.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: PRO MANAGEMENT (Rs.99 / month & Rs.999 / year Verification) */}
      {activeTab === 'pro' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Rs.99 / month & Rs.999 / year Manual Pro Verification Queue
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Approve verified manual payment requests (eSewa/Khalti: 9748711951 · Support: roilaofficial571@gmail.com) to activate Pro access (30 days for Rs.99 / month, 365 days for Rs.999 / year).
            </p>
          </div>

          {proRequests.length === 0 ? (
            <div className="p-8 text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-500">
              No Pro upgrade requests submitted yet.
            </div>
          ) : (
            <div className="space-y-3">
              {proRequests.map((pr) => (
                <div
                  key={pr.id}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-sm text-slate-900 dark:text-white">
                        {pr.userName}
                      </span>
                      <span className="text-xs text-slate-500 ml-2">
                        ({pr.userEmail})
                      </span>
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                      Ref: {pr.referenceId} ·{' '}
                      {pr.amount === 999 ? 'Rs.999 / year' : 'Rs.99 / month'} · Status:{' '}
                      {pr.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap gap-4">
                    <span>Method: {pr.paymentMethod}</span>
                    <span>·</span>
                    <span>Sender Details: {pr.senderInfo}</span>
                    <span>·</span>
                    <span>Submitted: {pr.createdAt.slice(0, 10)}</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={adminNotesMap[pr.id] ?? ''}
                      onChange={(e) =>
                        setAdminNotesMap((prev) => ({
                          ...prev,
                          [pr.id]: e.target.value,
                        }))
                      }
                      placeholder="Admin verification note (e.g. Verified eSewa txn)..."
                      className="flex-1 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReviewProRequest(pr.id, 'approved')}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Approve & Activate Pro</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewProRequest(pr.id, 'rejected')}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 text-xs font-medium flex items-center gap-1.5 transition-colors"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: ROUTINE CATEGORIES MANAGEMENT */}
      {activeTab === 'routines' && (
        <div className="space-y-5">
          <form
            onSubmit={handleCreateCategory}
            className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Add Default Routine Category & Suggested Activity
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                required
                value={catNameEn}
                onChange={(e) => setCatNameEn(e.target.value)}
                placeholder="Category (English)"
                className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <input
                type="text"
                value={catNameNe}
                onChange={(e) => setCatNameNe(e.target.value)}
                placeholder="Category (Nepali)"
                className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <input
                type="text"
                value={catIcon}
                onChange={(e) => setCatIcon(e.target.value)}
                placeholder="Emoji Icon (e.g. 🧘)"
                className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <input
                type="text"
                value={catSuggestedEn}
                onChange={(e) => setCatSuggestedEn(e.target.value)}
                placeholder="Suggested Routine (EN)"
                className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <input
                type="text"
                value={catSuggestedNe}
                onChange={(e) => setCatSuggestedNe(e.target.value)}
                placeholder="Suggested Routine (NE)"
                className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <input
                type="time"
                value={catDefaultTime}
                onChange={(e) => setCatDefaultTime(e.target.value)}
                className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
              />
            </div>
            <button
              type="submit"
              className="min-h-[40px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Category</span>
            </button>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{cat.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {cat.nameEn} / {cat.nameNe}
                    </p>
                    <p className="text-xs text-slate-500">
                      Suggested: {cat.suggestedTitleEn} ({cat.defaultTime})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(cat.id)}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  aria-label="Delete category"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: ADS MANAGER */}
      {activeTab === 'ads' && (
        <div className="space-y-6">
          {/* Global Toggle */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Global Ad Display (Free Users Only)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pro users remain 100% ad-free. Only active and valid-date banners are shown to Free users.
              </p>
            </div>
            <div className="inline-flex items-center p-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => handleToggleGlobalAds(true)}
                className={`min-h-[34px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  adsEnabledGlobal
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Ads Enabled
              </button>
              <button
                type="button"
                onClick={() => handleToggleGlobalAds(false)}
                className={`min-h-[34px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  !adsEnabledGlobal
                    ? 'bg-slate-700 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Ads Disabled
              </button>
            </div>
          </div>

          {/* SECTION 1: MANUAL BANNER AD MANAGEMENT (SLIDESHOW / CAROUSEL) */}
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                  <span>
                    {editingBannerId
                      ? 'Edit Manual Banner Ad'
                      : 'Manual Banner Ad Management (Slideshow / Carousel)'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Upload multiple banner images. Active banners within valid dates automatically rotate as a mobile-responsive slideshow for Free users.
                </p>
              </div>
              {editingBannerId && (
                <button
                  type="button"
                  onClick={resetManualBannerForm}
                  className="min-h-[34px] px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel Edit</span>
                </button>
              )}
            </div>

            <form onSubmit={handleSaveManualBanner} className="space-y-4">
              {/* Banner Image Upload & Preview */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  1. Upload Banner Image
                </label>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  <label className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-teal-700 hover:bg-slate-800 dark:hover:bg-teal-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors shrink-0">
                    <Upload className="w-4 h-4" />
                    <span>
                      {bannerUploading
                        ? 'Uploading...'
                        : bannerImageUrl
                        ? 'Change Banner Image'
                        : 'Upload Banner Image'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleBannerFileChange}
                      className="hidden"
                    />
                  </label>

                  <input
                    type="text"
                    value={bannerImageUrl}
                    onChange={(e) => setBannerImageUrl(e.target.value)}
                    placeholder="Or paste banner image URL (/uploads/... or https://...)"
                    className="flex-1 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                  />

                  {bannerImageUrl && (
                    <button
                      type="button"
                      onClick={() => setBannerImageUrl('')}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      Clear Image
                    </button>
                  )}
                </div>

                {bannerImageUrl && (
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-500">
                      Banner Preview (Aspect Ratio Preserved):
                    </span>
                    <img
                      src={bannerImageUrl}
                      alt="Banner preview"
                      className="w-full max-h-[160px] h-auto object-contain rounded-lg mx-auto block"
                    />
                  </div>
                )}

                {/* Placement Checkboxes (Upload ONCE → select Pages & Positions) */}
                <div className="p-3.5 rounded-xl border border-teal-200/80 dark:border-teal-900/60 bg-teal-50/40 dark:bg-teal-950/20 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Placement Checkboxes (Select where this banner appears for Free users)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setBannerPages(['home', 'planner', 'reports', 'profile']);
                        setBannerPositions(['top', 'bottom']);
                      }}
                      className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                    >
                      Select All (4 Pages + Top & Bottom)
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    {ALL_AD_PAGES.map((pg) => {
                      const checked = bannerPages.includes(pg.id);
                      return (
                        <label
                          key={pg.id}
                          className={`min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-2 cursor-pointer select-none transition-colors ${
                            checked
                              ? 'border-teal-600 bg-white dark:bg-slate-900 text-teal-800 dark:text-teal-300 font-semibold shadow-2xs'
                              : 'border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBannerPage(pg.id)}
                            className="w-4 h-4 rounded accent-teal-600"
                          />
                          <span>{pg.label}</span>
                        </label>
                      );
                    })}

                    {ALL_AD_POSITIONS.map((pos) => {
                      const checked = bannerPositions.includes(pos.id);
                      return (
                        <label
                          key={pos.id}
                          className={`min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-2 cursor-pointer select-none transition-colors ${
                            checked
                              ? 'border-slate-900 dark:border-teal-500 bg-slate-900 dark:bg-teal-700 text-white font-semibold shadow-2xs'
                              : 'border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBannerPosition(pos.id)}
                            className="w-4 h-4 rounded accent-teal-500"
                          />
                          <span>{pos.label}</span>
                        </label>
                      );
                    })}
                  </div>

                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    Selected:{' '}
                    {bannerPages.length > 0
                      ? ALL_AD_PAGES.filter((p) => bannerPages.includes(p.id))
                          .map((p) => p.label)
                          .join(' + ')
                      : 'None'}{' '}
                    →{' '}
                    {bannerPositions.length > 0
                      ? ALL_AD_POSITIONS.filter((p) =>
                          bannerPositions.includes(p.id)
                        )
                          .map((p) => p.label)
                          .join(' + ')
                      : 'None'}
                  </p>
                </div>
              </div>

              {/* Title (Optional), Target URL, Status, Start/End Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    2. Banner Title (Optional)
                  </label>
                  <input
                    type="text"
                    value={bannerTitle}
                    onChange={(e) => setBannerTitle(e.target.value)}
                    placeholder="Optional banner title / caption"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    3. Target URL (Click Action)
                  </label>
                  <input
                    type="text"
                    required
                    value={bannerTargetUrl}
                    onChange={(e) => setBannerTargetUrl(e.target.value)}
                    placeholder="https://example.com or #upgrade"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    4. Status (Active / Inactive)
                  </label>
                  <select
                    value={bannerActive ? 'active' : 'inactive'}
                    onChange={(e) => setBannerActive(e.target.value === 'active')}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-medium"
                  >
                    <option value="active">Active (Show to Free Users)</option>
                    <option value="inactive">Inactive (Hidden)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    5. Start Date
                  </label>
                  <input
                    type="date"
                    required
                    value={bannerStartDate}
                    onChange={(e) => setBannerStartDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    6. End Date
                  </label>
                  <input
                    type="date"
                    required
                    value={bannerEndDate}
                    onChange={(e) => setBannerEndDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Slideshow Order Priority (1-100)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={bannerPriority}
                    onChange={(e) => setBannerPriority(e.target.value)}
                    title="Slide Order Priority (1-100)"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="submit"
                  disabled={bannerUploading}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>
                    {editingBannerId ? 'Update Banner Ad' : 'Save Manual Banner'}
                  </span>
                </button>
                {editingBannerId && (
                  <button
                    type="button"
                    onClick={resetManualBannerForm}
                    className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>

            {/* Saved Manual Banners List */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Uploaded Manual Banners ({ads.filter((a) => a.type === 'manual').length})
                </h4>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Active Valid-Date Banners in Slideshow:{' '}
                  <strong className="text-teal-700 dark:text-teal-400">
                    {
                      ads.filter(
                        (a) =>
                          a.type === 'manual' &&
                          a.active &&
                          (!a.startDate || a.startDate <= defaultStart) &&
                          (!a.endDate || a.endDate >= defaultStart)
                      ).length
                    }
                  </strong>
                </span>
              </div>

              {ads.filter((a) => a.type === 'manual').length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                  No manual banners uploaded yet. Upload a banner image above to start the slideshow.
                </div>
              ) : (
                <div className="space-y-3">
                  {ads
                    .filter((a) => a.type === 'manual')
                    .map((ad) => {
                      const isDateValid =
                        (!ad.startDate || ad.startDate <= defaultStart) &&
                        (!ad.endDate || ad.endDate >= defaultStart);
                      const { pages: adPages, positions: adPositions } =
                        extractSelectionFromAd(ad);
                      return (
                        <div
                          key={ad.id}
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 space-y-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3.5 min-w-0 flex-1">
                              {ad.imageUrl ? (
                                <div className="w-full sm:w-44 h-20 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                                  <img
                                    src={ad.imageUrl}
                                    alt={ad.title || 'Banner'}
                                    className="max-h-full max-w-full object-contain rounded"
                                  />
                                </div>
                              ) : (
                                <div className="w-full sm:w-44 h-20 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-xs text-slate-400 shrink-0">
                                  Text Only
                                </div>
                              )}

                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                    {ad.title || '(No Title — Image Banner)'}
                                  </p>
                                  <span
                                    className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md ${
                                      ad.active && isDateValid
                                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                    }`}
                                  >
                                    {ad.active
                                      ? isDateValid
                                        ? 'ACTIVE IN SLIDESHOW'
                                        : 'OUT OF DATE RANGE'
                                      : 'INACTIVE'}
                                  </span>
                                </div>

                                <p className="text-xs font-mono text-teal-700 dark:text-teal-400 truncate flex items-center gap-1">
                                  <span>Target URL: {ad.targetUrl || '#upgrade'}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </p>

                                <p className="text-[11px] text-slate-500 font-mono">
                                  Dates: {ad.startDate} to {ad.endDate} · Priority: {ad.priority}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-center">
                              <div className="inline-flex items-center p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                                <button
                                  type="button"
                                  onClick={() => handleSetAdActive(ad, true)}
                                  className={`min-h-[32px] px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                                    ad.active
                                      ? 'bg-emerald-700 text-white shadow-2xs'
                                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                  }`}
                                >
                                  Active
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSetAdActive(ad, false)}
                                  className={`min-h-[32px] px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                                    !ad.active
                                      ? 'bg-slate-700 text-white shadow-2xs'
                                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                  }`}
                                >
                                  Inactive
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleStartEditBanner(ad)}
                                className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium inline-flex items-center gap-1"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteAd(ad.id)}
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-red-600 hover:border-red-200"
                                aria-label="Delete banner"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Direct Placement Checkboxes per Uploaded Banner */}
                          <div className="pt-2.5 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1">
                              Placements:
                            </span>
                            {ALL_AD_PAGES.map((pg) => {
                              const checked = adPages.includes(pg.id);
                              return (
                                <label
                                  key={pg.id}
                                  className={`px-2.5 py-1 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer select-none transition-colors ${
                                    checked
                                      ? 'border-teal-600 bg-teal-50/70 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
                                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const nextPages = checked
                                        ? adPages.filter((p) => p !== pg.id)
                                        : [...adPages, pg.id];
                                      handleQuickUpdatePlacements(
                                        ad,
                                        nextPages,
                                        adPositions
                                      );
                                    }}
                                    className="w-3.5 h-3.5 rounded accent-teal-600"
                                  />
                                  <span>{pg.label}</span>
                                </label>
                              );
                            })}

                            <span className="text-slate-300 dark:text-slate-700">
                              →
                            </span>

                            {ALL_AD_POSITIONS.map((pos) => {
                              const checked = adPositions.includes(pos.id);
                              return (
                                <label
                                  key={pos.id}
                                  className={`px-2.5 py-1 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer select-none transition-colors ${
                                    checked
                                      ? 'border-slate-800 dark:border-teal-500 bg-slate-900 dark:bg-teal-700 text-white'
                                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const nextPositions = checked
                                        ? adPositions.filter((p) => p !== pos.id)
                                        : [...adPositions, pos.id];
                                      handleQuickUpdatePlacements(
                                        ad,
                                        adPages,
                                        nextPositions
                                      );
                                    }}
                                    className="w-3.5 h-3.5 rounded accent-teal-500"
                                  />
                                  <span>{pos.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: PRESERVED GOOGLE ADSENSE SETTINGS */}
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Google AdSense Settings
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Configure Google AdSense slot IDs and placements for Free users.
              </p>
            </div>

            <form onSubmit={handleCreateAd} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  value={adTitle}
                  onChange={(e) => setAdTitle(e.target.value)}
                  placeholder="AdSense placement label / title"
                  className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />

                <input
                  type="text"
                  required
                  value={adSenseSlot}
                  onChange={(e) => setAdSenseSlot(e.target.value)}
                  placeholder="AdSense Slot ID (e.g. ca-pub-xxx)"
                  className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-mono"
                />

                <select
                  value={adPlacement}
                  onChange={(e) => setAdPlacement(e.target.value as AdPlacement)}
                  className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="home_top">Home Top</option>
                  <option value="home_bottom">Home Bottom</option>
                  <option value="planner_top">Planner Top</option>
                  <option value="planner_bottom">Planner Bottom</option>
                  <option value="reports_top">Reports Top</option>
                  <option value="reports_bottom">Reports Bottom</option>
                  <option value="profile_top">Profile Top</option>
                  <option value="profile_bottom">Profile Bottom</option>
                </select>

                <input
                  type="date"
                  value={adStartDate}
                  onChange={(e) => setAdStartDate(e.target.value)}
                  className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-mono"
                />

                <input
                  type="date"
                  value={adEndDate}
                  onChange={(e) => setAdEndDate(e.target.value)}
                  className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-mono"
                />

                <input
                  type="number"
                  min={1}
                  max={100}
                  value={adPriority}
                  onChange={(e) => setAdPriority(e.target.value)}
                  placeholder="Priority (1-100)"
                  className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-mono"
                />
              </div>
              <button
                type="submit"
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Save AdSense Slot</span>
              </button>
            </form>

            {ads.filter((a) => a.type === 'adsense').length > 0 && (
              <div className="space-y-2.5 pt-2">
                {ads
                  .filter((a) => a.type === 'adsense')
                  .map((ad) => (
                    <div
                      key={ad.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {ad.title}
                        </p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          ADSENSE ({ad.adSenseSlot}) · Placement: {ad.placement} · {ad.startDate} to {ad.endDate}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleAdActive(ad)}
                          className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border ${
                            ad.active
                              ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                              : 'border-slate-300 text-slate-500'
                          }`}
                        >
                          {ad.active ? 'Active' : 'Inactive'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAd(ad.id)}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600"
                          aria-label="Delete AdSense slot"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
