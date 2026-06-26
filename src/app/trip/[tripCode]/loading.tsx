import { MercuryLoader } from "@/app/components/MercuryLoader";

// Plays the brand animation while a trip's itinerary loads (the ~1s cold render).
export default function Loading() {
  return <MercuryLoader />;
}
