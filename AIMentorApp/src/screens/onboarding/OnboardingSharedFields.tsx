/**
 * OnboardingSharedFields.tsx
 * Shared pieces for the single-page "boxes" onboarding screens
 * (student, teacher, parent): the City/School autocomplete field,
 * the geocoding helpers behind it, and the card header used by every card.
 */
import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { TEAL } from './OnboardingScreen';

export async function fetchCitySuggestions(query: string): Promise<string[]> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&accept-language=en&limit=8&q=${encodeURIComponent(query)}`);
  const data = await res.json();
  const names = (Array.isArray(data) ? data : [])
    .map((d: any) => {
      const a = d.address || {};
      const cityName = a.city || a.town || a.village;
      if (!cityName) return null;
      return a.state ? `${cityName}, ${a.state}` : cityName;
    })
    .filter((v: any): v is string => !!v);
  return Array.from(new Set(names)).slice(0, 6);
}

export type BBox = [number, number, number, number]; // south, north, west, east

export async function fetchCityBBox(city: string): Promise<BBox | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&accept-language=en&limit=1&q=${encodeURIComponent(city)}`);
  const data = await res.json();
  const box = data?.[0]?.boundingbox;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [south, north, west, east] = box.map(Number);
  return [south, north, west, east];
}

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';

// Looks up nearby schools via the Google Places Autocomplete (New) API,
// biased to the entered city's location. Caches each city's lat/lng
// (via Nominatim) so repeated keystrokes don't re-geocode the city every time.
// Falls back to OpenStreetMap (Overpass) if no Google API key is configured.
export async function fetchSchoolSuggestions(query: string, city: string, bboxCache: Map<string, BBox | null>): Promise<string[]> {
  const cityKey = city.trim().toLowerCase();
  if (!cityKey) return [];

  let bbox = bboxCache.get(cityKey);
  if (bbox === undefined) {
    bbox = await fetchCityBBox(city.trim());
    bboxCache.set(cityKey, bbox);
  }
  if (!bbox) return [];

  const [south, north, west, east] = bbox;
  const lat = (south + north) / 2;
  const lng = (west + east) / 2;

  if (GOOGLE_PLACES_API_KEY) {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'suggestions.placePrediction.text.text',
      },
      body: JSON.stringify({
        input: query,
        includedPrimaryTypes: ['school'],
        locationBias: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 30000 },
        },
      }),
    });
    const data = await res.json();
    const names = (data?.suggestions || [])
      .map((s: any) => s.placePrediction?.text?.text as string | undefined)
      .filter((name?: string): name is string => !!name);
    return Array.from(new Set(names)).slice(0, 6) as string[];
  }

  const overpassQuery = `[out:json][timeout:15];node["amenity"="school"]["name"](${south},${west},${north},${east});out 60;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(overpassQuery)}`,
  });
  const data = await res.json();
  const q = query.toLowerCase();
  const names = (data?.elements || [])
    .map((el: any) => el.tags?.name as string | undefined)
    .filter((name?: string): name is string => !!name && name.toLowerCase().includes(q));
  return Array.from(new Set(names)).slice(0, 6) as string[];
}

// Reverse-geocodes the browser's current position to a "City, State" string.
export function locateCity(onFound: (city: string) => void, setLocating: (v: boolean) => void) {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.geolocation) return;
  setLocating(true);
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&accept-language=en&lat=${latitude}&lon=${longitude}`);
        const data = await res.json();
        const addr = data.address || {};
        const cityName = addr.city || addr.town || addr.village || addr.county || '';
        if (cityName) onFound(addr.state ? `${cityName}, ${addr.state}` : cityName);
      } catch {
        // ignore — user can type the city manually
      } finally {
        setLocating(false);
      }
    },
    () => setLocating(false),
    { timeout: 8000 },
  );
}

// Generic text input with a debounced search dropdown — used for City and
// School so users can pick from suggestions or just type their own ("Other").
export function AutocompleteField({
  value, onChange, fetchSuggestions, placeholder, colors, styles, disabledMessage,
}: {
  value: string;
  onChange: (v: string) => void;
  fetchSuggestions: (query: string) => Promise<string[]>;
  placeholder: string;
  colors: any;
  styles: any;
  disabledMessage?: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<any>(null);

  function handleChange(text: string) {
    onChange(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    if (disabledMessage) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const results = await fetchSuggestions(text.trim());
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 400);
  }

  const showBox = open && suggestions.length > 0;

  return (
    <View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={handleChange}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
      />
      {showBox && (
        <View style={styles.dropdown}>
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={`${s}-${i}`}
              style={styles.dropdownItem}
              onPressIn={() => { onChange(s); setOpen(false); }}
              activeOpacity={0.8}>
              <Text style={styles.dropdownTxt}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// Card header — icon, title, subtitle, and a check badge once the card is complete.
export function CardHeader({
  icon, title, subtitle, done, styles,
}: { icon: string; title: string; subtitle: string; done: boolean; styles: any }) {
  return (
    <View style={styles.cardHeaderRow}>
      <View style={styles.cardIcon}><Feather name={icon as any} size={18} color={TEAL} /></View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          {done && (
            <View style={styles.cardCheck}><Feather name="check" size={11} color="#fff" /></View>
          )}
        </View>
        <Text style={styles.cardSub}>{subtitle}</Text>
      </View>
    </View>
  );
}
