/**
 * Cách xưng hô gợi ý, chia theo nhóm. Chủ tiệc tự chọn cho từng khách —
 * hệ thống không suy đoán giới tính hay quan hệ. Có thể tự nhập cách gọi khác.
 */
export const salutationGroups: Array<{ label: string; items: string[] }> = [
  { label: 'Bậc ông bà', items: ['Ông', 'Bà', 'Ông Bà', 'Cụ', 'Ông Nội', 'Bà Nội', 'Ông Ngoại', 'Bà Ngoại'] },
  { label: 'Bậc cha mẹ, cô dì chú bác', items: ['Bác', 'Bác Trai', 'Bác Gái', 'Chú', 'Thím', 'Chú Thím', 'Cô', 'Dượng', 'Cô Dượng', 'Dì', 'Cậu', 'Mợ', 'Cậu Mợ', 'Bác Gái và Bác Trai'] },
  { label: 'Ngang hàng', items: ['Anh', 'Chị', 'Anh Chị', 'Bạn', 'Em', 'Anh Em'] },
  { label: 'Bậc con cháu', items: ['Cháu', 'Con', 'Em', 'Các cháu'] },
  { label: 'Gia đình', items: ['Gia đình', 'Gia đình Ông Bà', 'Gia đình Bác', 'Gia đình Chú', 'Gia đình Cô', 'Gia đình Cậu', 'Gia đình Dì', 'Gia đình Anh', 'Gia đình Chị', 'Gia đình Anh Chị', 'Gia đình Em', 'Vợ chồng'] },
  { label: 'Trang trọng', items: ['Quý khách', 'Quý Ông', 'Quý Bà', 'Thầy', 'Cô giáo', 'Thầy Cô', 'Sếp', 'Bác sĩ', 'Luật sư', 'Kỹ sư'] },
];

export const salutations = [...new Set(salutationGroups.flatMap((g) => g.items))];
