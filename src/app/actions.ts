"use server";

import { revalidatePath } from "next/cache";
import { getBookingForEdit, saveBooking, searchLinkableBookings, linkBooking, type BookingValues, type SaveResult, type LinkableBooking } from "@/server/bookings";
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

/** Search existing bookings of a type to attach to a trip (excludes this trip). */
export async function searchLinkableBookingsAction(
  type: BookingType,
  tripCode: string,
  query: string,
): Promise<LinkableBooking[]> {
  return searchLinkableBookings(type, tripCode, query);
}

/** Attach an existing booking to a trip, then refresh the itinerary + list. */
export async function linkBookingAction(input: {
  type: BookingType;
  recordId: string;
  tripRecordId: string;
  tripCode: string;
  date?: string | null;
  /** Trips the booking is moving off of — refresh their itineraries too. */
  fromTripCodes?: string[];
}): Promise<SaveResult> {
  const res = await linkBooking(input);
  if (res.ok) {
    revalidatePath(`/trip/${input.tripCode}`);
    for (const code of input.fromTripCodes ?? []) revalidatePath(`/trip/${code}`);
    revalidatePath("/");
  }
  return res;
}

/** Create a trip, then refresh the trips list. */
export async function createTripAction(input: CreateTripInput): Promise<CreateTripResult> {
  const result = await createTrip(input);
  if (result.ok) revalidatePath("/");
  return result;
}
