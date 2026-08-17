package cm.afriland.titres.registration;

import com.anthropic.models.messages.Base64ImageSource;

/** Data URL decodee : payload base64 + type MIME reconnu par l'API Claude vision. */
record DataUri(String data, Base64ImageSource.MediaType mediaType) {

    static DataUri parse(String dataUrl) {
        if (dataUrl == null || !dataUrl.startsWith("data:")) {
            return null;
        }
        int comma = dataUrl.indexOf(',');
        if (comma < 5) {
            return null;
        }
        String meta = dataUrl.substring(5, comma).toLowerCase();
        String mime = meta.split(";")[0].trim();
        Base64ImageSource.MediaType mediaType = switch (mime) {
            case "image/jpeg", "image/jpg" -> Base64ImageSource.MediaType.IMAGE_JPEG;
            case "image/png" -> Base64ImageSource.MediaType.IMAGE_PNG;
            case "image/webp" -> Base64ImageSource.MediaType.IMAGE_WEBP;
            case "image/gif" -> Base64ImageSource.MediaType.IMAGE_GIF;
            default -> null;
        };
        if (mediaType == null) {
            return null;
        }
        return new DataUri(dataUrl.substring(comma + 1), mediaType);
    }
}
