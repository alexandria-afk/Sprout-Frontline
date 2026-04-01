/// Represents a single announcement returned by GET /api/v1/announcements/
class Announcement {
  final String id;
  final String title;
  final String body;
  final String? mediaUrl;
  final List<String> mediaUrls;
  final String? creatorName;
  final bool requiresAcknowledgement;
  final String createdAt;
  final bool isRead;
  final bool isAcknowledged;

  const Announcement({
    required this.id,
    required this.title,
    required this.body,
    this.mediaUrl,
    this.mediaUrls = const [],
    this.creatorName,
    required this.requiresAcknowledgement,
    required this.createdAt,
    required this.isRead,
    required this.isAcknowledged,
  });

  factory Announcement.fromJson(Map<String, dynamic> json) {
    final rawUrls = json['media_urls'] as List?;
    return Announcement(
      id: (json['id'] as String?) ?? '',
      title: (json['title'] as String?) ?? '',
      body: (json['body'] as String?) ?? '',
      mediaUrl: json['media_url'] as String?,
      mediaUrls: rawUrls?.map((e) => e.toString()).toList() ?? [],
      creatorName: json['creator_name'] as String?,
      requiresAcknowledgement:
          (json['requires_acknowledgement'] as bool?) ?? false,
      createdAt: (json['created_at'] as String?) ??
          (json['publish_at'] as String?) ??
          '',
      isRead: json['read_at'] != null,
      isAcknowledged: (json['my_acknowledged'] as bool?) ??
          json['acknowledged_at'] != null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'body': body,
        'media_url': mediaUrl,
        'media_urls': mediaUrls,
        'creator_name': creatorName,
        'requires_acknowledgement': requiresAcknowledgement,
        'created_at': createdAt,
        'read_at': isRead ? DateTime.now().toIso8601String() : null,
        'my_acknowledged': isAcknowledged,
      };

  Announcement copyWithRead() => Announcement(
        id: id,
        title: title,
        body: body,
        mediaUrl: mediaUrl,
        mediaUrls: mediaUrls,
        creatorName: creatorName,
        requiresAcknowledgement: requiresAcknowledgement,
        createdAt: createdAt,
        isRead: true,
        isAcknowledged: isAcknowledged,
      );

  Announcement copyWithAcknowledged() => Announcement(
        id: id,
        title: title,
        body: body,
        mediaUrl: mediaUrl,
        mediaUrls: mediaUrls,
        creatorName: creatorName,
        requiresAcknowledgement: requiresAcknowledgement,
        createdAt: createdAt,
        isRead: isRead,
        isAcknowledged: true,
      );
}
