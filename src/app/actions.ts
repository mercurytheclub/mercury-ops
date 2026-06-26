"use server";

import { revalidatePath } from "next/cache";
import { getBookingForEdit, saveBooking, type BookingValues, type SaveResult } from "@/server/bookings";
import type { BookingType } from "@/lib/bookingFields";

/** Load a booking's editable field values for the drawer (edit mode). */
export async function loadBookingForEditAction(type: BookingType, recordId: string) {
  return getBookingForEdit(type, recordId);
}

/** Create or update a booking, then refresh the affected itinerary + list. */
export async function saveBookingAction(input: {
  type: BookingType;
  recordId?: string | null;
  tripRecordId?: string | null;
  tripCode?: string | null;
  values: BookingValues;
}): Promise<SaveResult> {
  const result = await saveBooking(input);
  if (result.ok && input.tripCode) {
    revalidatePath(`/trip/${input.tripCode}`);
    revalidatePath("/");
  }
  return result;
}
