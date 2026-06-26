"use server";

import { revalidatePath } from "next/cache";
import { getBookingForEdit, saveBooking, type BookingValues, type SaveResult } from "@/server/bookings";
import { createTrip, type CreateTripInput, type CreateTripResult } from "@/server/trips";
import { loadGuestOptions, type GuestOption } from "@/server/airtable";
import { notifyTeam } from "@/server/notify";
import type { BookingType } from "@/lib/bookingFields";

/** Load a booking's editable field values for the drawer (edit mode). */
export async function loadBookingForEditAction(type: BookingType, recordId: string) {
  return getBookingForEdit(type, recordId);
}

/** Create or update a booking, notify the team, then refresh itinerary + list. */
export async function saveBookingAction(input: {
  type: BookingType;
  recordId?: string | null;
  tripRecordId?: string | null;
  tripCode?: string | null;
  tripName?: string | null;
  values: BookingValues;
}): Promise<SaveResult> {
  const result = await saveBooking(input);
  if (result.ok) {
    // WhatsApp the team group for this booking type (no-ops without WHAPI_TOKEN).
    await notifyTeam({
      type: input.type,
      isEdit: !!input.recordId,
      values: input.values,
      tripName: input.tripName ?? undefined,
    });
    if (input.tripCode) {
      revalidatePath(`/trip/${input.tripCode}`);
      revalidatePath("/");
    }
  }
  return result;
}

/** Guests for the "new trip" lead-guest / companions picker (loaded on open). */
export async function loadGuestOptionsAction(): Promise<GuestOption[]> {
  return loadGuestOptions();
}

/** Create a trip, then refresh the trips list. */
export async function createTripAction(input: CreateTripInput): Promise<CreateTripResult> {
  const result = await createTrip(input);
  if (result.ok) revalidatePath("/");
  return result;
}
