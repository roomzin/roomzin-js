export type Codecs = {
    amenities: string[];
    rateCancels: string[];
};

export function validateAmenities(codecs: Codecs, input: string[]): [boolean, string] {
    const invalid: string[] = [];

    for (const amenity of input) {
        if (!codecs.amenities.includes(amenity)) {
            invalid.push(amenity);
        }
    }

    if (invalid.length > 0) {
        return [false, "Invalid amenities: " + invalid.join(", ")];
    }
    return [true, ""];
}

export function validateRateCancels(codecs: Codecs, input: string[]): [boolean, string] {
    const invalid: string[] = [];

    for (const rate of input) {
        if (!codecs.rateCancels.includes(rate)) {
            invalid.push(rate);
        }
    }

    if (invalid.length > 0) {
        return [false, "Invalid rate cancels: " + invalid.join(", ")];
    }
    return [true, ""];
}